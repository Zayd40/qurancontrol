"""Local mixer capture -> Whisper -> JSON lines. Audio is never written to disk.

stdin carries context epochs, preventing pre-navigation audio from moving slides.
Heavy imports are deferred so device discovery does not load a speech model.
"""
import argparse
from collections import deque
import json
import os
import sys
import threading

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
                     os.environ.get('DUA_ASR_MODEL', 'openai/whisper-small')]:
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
    processor = AutoProcessor.from_pretrained(model_id)
    model = WhisperForConditionalGeneration.from_pretrained(model_id, torch_dtype=dtype).to(device).eval()
    model.generation_config.forced_decoder_ids = None

    lock = threading.Lock()
    blocks = deque(maxlen=80)  # bounded eight-second window, even during slow inference
    state = {'epoch': 0, 'serial': 0, 'overflow': False, 'ended': False}

    def commands():
        for line in sys.stdin:
            try:
                command = json.loads(line)
                with lock:
                    state['epoch'] = int(command['epoch'])
                    blocks.clear()
            except (ValueError, KeyError, TypeError):
                continue
        with lock:
            state['ended'] = True

    threading.Thread(target=commands, daemon=True).start()
    info = sd.query_devices(args.device, 'input')
    # Capture at the device's native rate; many Windows mixer inputs reject 16 kHz.
    rate = int(info['default_samplerate'])
    blocksize = max(1, rate // 10)
    channels = min(2, int(info['max_input_channels']))

    def capture(indata, frames, timing, status):
        with lock:
            # Choose the louder channel, avoiding cancellation on inverted stereo feeds.
            channel = int(np.argmax(np.mean(indata ** 2, axis=0)))
            blocks.append(indata[:, channel].copy())
            state['serial'] += 1
            state['overflow'] = state['overflow'] or bool(status)

    with sd.InputStream(device=args.device, samplerate=rate, blocksize=blocksize,
                        channels=channels, dtype='float32', callback=capture):
        emit({'type': 'status', 'state': 'listening', 'engine': model_id + ' / ' + device,
              'message': 'Listening to ' + info['name'] + (' on NVIDIA GPU' if use_cuda else ' on CPU (slower; check CUDA setup)')})
        last_decode = 0.0
        last_serial = -1
        while True:
            time.sleep(0.2)
            with lock:
                if state['ended']:
                    return
                epoch = state['epoch']
                serial = state['serial']
                recent = list(blocks)
                overflow = state['overflow']
                state['overflow'] = False
            if not recent:
                continue
            newest = np.concatenate(recent[-5:])
            rms = float(np.sqrt(np.mean(newest ** 2)))
            emit({'type': 'level', 'level': min(1.0, rms * 5),
                  'clipping': bool(np.max(np.abs(newest)) > 0.98),
                  'warning': 'Audio input overflow — check the audio driver.' if overflow else ''})
            if rms < args.noise_floor:
                # Discard old speech after a pause; never repeatedly decode stale audio.
                if len(recent) >= 15 and all(float(np.sqrt(np.mean(b ** 2))) < args.noise_floor for b in recent[-15:]):
                    with lock:
                        if state['epoch'] == epoch:
                            blocks.clear()
                continue
            if len(recent) < 15 or serial == last_serial or time.monotonic() - last_decode < 1.5:
                continue
            audio = np.concatenate(recent)
            # Linear resampling is sufficient for a speech-location input; the display
            # always renders canonical text, never this model's transcription.
            count = max(1, round(len(audio) * 16000 / rate))
            audio = np.interp(np.arange(count) * rate / 16000, np.arange(len(audio)), audio).astype(np.float32)
            features = processor(audio, sampling_rate=16000, return_tensors='pt').input_features.to(device=device, dtype=dtype)
            with torch.inference_mode():
                tokens = model.generate(features, language='ar', task='transcribe',
                                        max_new_tokens=128, num_beams=1, do_sample=False)
            text = processor.batch_decode(tokens, skip_special_tokens=True)[0].strip()
            last_decode = time.monotonic()
            last_serial = serial
            with lock:
                valid = state['epoch'] == epoch
            if valid and text:
                emit({'type': 'transcript', 'epoch': epoch, 'text': text})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
