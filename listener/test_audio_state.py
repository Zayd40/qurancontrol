import unittest
from audio_state import AudioWindow, language_decision


class AudioPolicyTests(unittest.TestCase):
    def voiced(self, window, count=8):
        for i in range(count):
            window.append('speech-' + str(i), True)

    def test_first_recognition_needs_only_eight_tenths_of_audio(self):
        window = AudioWindow()
        self.voiced(window, 7)
        self.assertIsNone(window.snapshot(0))
        self.voiced(window, 1)
        self.assertIsNotNone(window.snapshot(0))

    def test_half_second_cadence_does_not_add_inference_time(self):
        window = AudioWindow()
        self.voiced(window)
        self.assertIsNotNone(window.snapshot(1.0))
        self.voiced(window, 5)
        self.assertIsNone(window.snapshot(1.49))
        self.assertIsNotNone(window.snapshot(1.5))
        self.voiced(window, 8)
        self.assertIsNotNone(window.snapshot(3.0), 'a slow decode must not add another idle wait')

    def test_final_words_can_decode_at_a_brief_ayah_pause(self):
        window = AudioWindow()
        self.voiced(window)
        window.snapshot(1.0)
        self.voiced(window, 1)
        for _ in range(3):
            window.append('quiet', False)
        self.assertIsNotNone(window.snapshot(1.3))
        self.assertIsNone(window.snapshot(1.31), 'do not decode the same final words twice')

    def test_big_pause_invalidates_an_in_flight_result_and_flushes_old_audio(self):
        window = AudioWindow()
        window.context(4, True)
        self.voiced(window)
        snapshot = window.snapshot(0)
        for _ in range(12):
            window.append('quiet', False)
        self.assertFalse(window.valid(snapshot))
        events = window.drain_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['reason'], 'silence')
        self.assertEqual(events[0]['epoch'], 4)
        self.assertFalse(window.blocks)
        for _ in range(100):
            window.append('quiet', False)
        self.assertFalse(window.drain_events(), 'one event per pause')
        self.assertIsNone(window.snapshot(10))
        self.voiced(window)
        fresh = window.snapshot(11)
        self.assertNotIn('speech-7', fresh.blocks[:-8])
        self.assertTrue(window.valid(fresh))

    def test_english_rejection_retains_only_audio_that_arrived_after_its_snapshot(self):
        window = AudioWindow()
        self.voiced(window)
        english = window.snapshot(0)
        for _ in range(8):
            window.append('new-arabic', True)
        window.reject(english, 'non_arabic')
        self.assertFalse(window.valid(english))
        self.assertEqual(window.drain_events()[0]['reason'], 'non_arabic')
        fresh = window.snapshot(1)
        self.assertEqual(fresh.blocks, ['new-arabic'] * 8)

    def test_stop_and_go_discard_old_samples_without_reloading_a_model(self):
        window = AudioWindow()
        self.voiced(window)
        old = window.snapshot(0)
        window.context(2, False)
        self.voiced(window, 100)
        self.assertFalse(window.blocks)
        self.assertFalse(window.valid(old))
        window.context(3, True)
        self.voiced(window)
        self.assertEqual(window.snapshot(0).epoch, 3)

    def test_slow_inference_never_builds_an_audio_backlog(self):
        window = AudioWindow()
        self.voiced(window, 10000)
        self.assertEqual(len(window.blocks), 40)

    def test_language_gate_accepts_arabic_and_blocks_english_and_uncertainty(self):
        self.assertEqual(language_decision({'<|ar|>': 0.9, '<|en|>': 0.05}), 'arabic')
        self.assertEqual(language_decision({'<|ar|>': 0.05, '<|en|>': 0.9}), 'non_arabic')
        self.assertEqual(language_decision({'<|ar|>': 0.51, '<|en|>': 0.49}), 'uncertain')
        self.assertEqual(language_decision({}), 'uncertain')
        self.assertEqual(language_decision({'<|ar|>': 0.41, '<|ur|>': 0.11}), 'arabic')
        self.assertEqual(language_decision({'<|ar|>': 0.35, '<|en|>': 0.32}), 'uncertain')


if __name__ == '__main__':
    unittest.main()
