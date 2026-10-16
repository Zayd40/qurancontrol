"""Local mixer capture -> Whisper -> JSON lines. Audio is never written to disk.

stdin carries context epochs, preventing pre-navigation audio from moving slides.
Heavy imports are deferred so device discovery does not load a speech model.
"""
import argparse
import json
import os
import sys
import threading
from audio_state import AudioWindow, language_decision

os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
import time


def emit(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--list-devices', action='store_true')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--device', type=int)
    parser.add_argument('--mode', choices=['quran', 'dua'], default='quran')
    parser.add_argument('--noise-floor', type=float, default=0.008)
    args = parser.parse_args()
    import sounddevice as sd
    if args.list_devices:
        devices = sd.query_devices()
        hosts = sd.query_hostapis()
        emit([{'id': index, 'name': device['name'],
               'host': hosts[device['hostapi']]['name'],
               'channels': device['max_input_channels']}
              for index, device in enumerate(devices) if device['max_input_channels'] > 0])
        return

    import numpy as np
    import torch
    from transformers import AutoProcessor, WhisperForConditionalGeneration

    if args.prepare:
        for name in [os.environ.get('QURAN_ASR_MODEL', 'tarteel-ai/whisper-base-ar-quran'),
                     os.environ.get('DUA_ASR_MODEL', 'openai/whisper-small'),
                     os.environ.get('LANGUAGE_ASR_MODEL', 'openai/whisper-tiny')]:
            print('Caching ' + name, file=sys.stderr)
            AutoProcessor.from_pretrained(name)
            cached = WhisperForConditionalGeneration.from_pretrained(name)
            del cached
        return

    model_id = os.environ.get('QURAN_ASR_MODEL', 'tarteel-ai/whisper-base-ar-quran') if args.mode == 'quran' else os.environ.get('DUA_ASR_MODEL', 'openai/whisper-small')
    use_cuda = torch.cuda.is_available()
    device = 'cuda' if use_cuda else 'cpu'
    dtype = torch.float16 if use_cuda else torch.float32
    emit({'type': 'status', 'state': 'loading', 'message': 'Loading ' + model_id})
    processor = AutoProcessor.from_pretrained(model_id, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(model_id, torch_dtype=dtype, local_files_only=True).to(device).eval()
    model.generation_config.forced_decoder_ids = None

    # Use an independent multilingual model: the Qur'an fine-tune is forced to
    # Arabic and must not decide for itself whether the input is English.
    gate_id = os.environ.get('LANGUAGE_ASR_MODEL', 'openai/whisper-tiny')
    gate_processor = AutoProcessor.from_pretrained(gate_id, local_files_only=True)
    gate_model = WhisperForConditionalGeneration.from_pretrained(gate_id, torch_dtype=dtype, local_files_only=True).to(device).eval()
    language_tokens = gate_model.generation_config.lang_to_id
    language_names = list(language_tokens)
    language_ids = [language_tokens[name] for name in language_names]
    decoder_start = torch.tensor([[gate_model.config.decoder_start_token_id]], device=device)

    lock = threading.Lock()
    audio_window = AudioWindow()
    overflowed = False

    def commands():
        for line in sys.stdin:
            try:
                command = json.loads(line)
                with lock:
                    audio_window.context(int(command['epoch']), bool(command.get('enabled', True)))
            except (ValueError, KeyError, TypeError):
                continue
        with lock:
            audio_window.ended = True

    threading.Thread(target=commands, daemon=True).start()
    info = sd.query_devices(args.device, 'input')
    # Capture at the device's native rate; many Windows mixer inputs reject 16 kHz.
    rate = int(info['default_samplerate'])
    blocksize = max(1, rate // 10)
    channels = min(2, int(info['max_input_channels']))

    def capture(indata, frames, timing, status):
        nonlocal overflowed
        with lock:
            if not audio_window.enabled:
                return
            # Choose the louder channel to avoid cancellation on inverted stereo.
            channel = int(np.argmax(np.mean(indata ** 2, axis=0)))
            block = indata[:, channel].copy()
            audio_window.append(block, float(np.sqrt(np.mean(block ** 2))) >= args.noise_floor)
            overflowed = overflowed or bool(status)

    def samples(blocks):
        audio = np.concatenate(blocks)
        count = max(1, round(len(audio) * 16000 / rate))
        return np.interp(np.arange(count) * rate / 16000, np.arange(len(audio)), audio).astype(np.float32)

    def report_interruptions():
        with lock:
            events = audio_window.drain_events()
        for event in events:
            emit(event)

    with sd.InputStream(device=args.device, samplerate=rate, blocksize=blocksize,
                        channels=channels, dtype='float32', callback=capture) as stream:
        emit({'type': 'status', 'state': 'listening', 'engine': model_id + ' / ' + device,
              'message': 'Listening to ' + info['name'] + (' on NVIDIA GPU' if use_cuda else ' on CPU (slower; check CUDA setup)')})
        while True:
            time.sleep(0.05)
            report_interruptions()
            with lock:
                if audio_window.ended:
                    return
                enabled = audio_window.enabled
            if not enabled:
                if stream.active:
                    stream.stop()
                continue
            if not stream.active:
                stream.start()
                continue
            with lock:
                recent = [block for _, block in audio_window.blocks]
                overflow = overflowed
                overflowed = False
                snapshot = audio_window.snapshot(time.monotonic())
            if not recent:
                continue
            newest = np.concatenate(recent[-3:])
            rms = float(np.sqrt(np.mean(newest ** 2)))
            emit({'type': 'level', 'level': min(1.0, rms * 5),
                  'clipping': bool(np.max(np.abs(newest)) > 0.98),
                  'warning': 'Audio input overflow — check the audio driver.' if overflow else ''})
            if snapshot is None:
                continue
            started = time.monotonic()
            # Inspect only the latest 1.6 seconds for language, so older Arabic
            # does not conceal an English announcement at the end of the window.
            gate_features = gate_processor(samples(snapshot.blocks[-16:]), sampling_rate=16000,
                                            return_tensors='pt').input_features.to(device=device, dtype=dtype)
            with torch.inference_mode():
                logits = gate_model(input_features=gate_features, decoder_input_ids=decoder_start).logits[0, -1]
                probabilities = torch.softmax(logits[language_ids].float(), dim=-1).cpu().tolist()
            decision = language_decision(dict(zip(language_names, probabilities)))
            with lock:
                valid = audio_window.valid(snapshot)
                if valid and decision != 'arabic':
                    audio_window.reject(snapshot, decision)
            report_interruptions()
            if not valid or decision != 'arabic':
                continue
            features = processor(samples(snapshot.blocks), sampling_rate=16000,
                                 return_tensors='pt').input_features.to(device=device, dtype=dtype)
            with torch.inference_mode():
                tokens = model.generate(features, language='ar', task='transcribe',
                                        max_new_tokens=96, num_beams=1, do_sample=False)
            text = processor.batch_decode(tokens, skip_special_tokens=True)[0].strip()
            with lock:
                valid = audio_window.valid(snapshot)
                if valid:
                    audio_window.last_rejection = None
            report_interruptions()
            if valid and text:
                emit({'type': 'transcript', 'epoch': snapshot.epoch, 'segment': snapshot.segment,
                      'language': 'ar', 'text': text,
                      'inferenceMs': round((time.monotonic() - started) * 1000)})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
