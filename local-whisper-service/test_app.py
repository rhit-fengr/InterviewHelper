from __future__ import annotations

import json
import logging
import unittest

import app as service_app


class FakeUpload:
    def __init__(self, content: bytes, filename: str = "chunk.webm") -> None:
        self._content = content
        self.filename = filename

    async def read(self) -> bytes:
        return self._content


class FakeModel:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def transcribe(self, _tmp_path: str, **_options):
        raise self.error


class LocalWhisperServiceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._logging_disable_level = logging.root.manager.disable
        logging.disable(logging.CRITICAL)

    def tearDown(self) -> None:
        logging.disable(self._logging_disable_level)

    def test_normalizes_bcp47_language_hint_for_whisper(self) -> None:
        self.assertEqual(service_app._normalize_language_hint("en-US"), "en")
        self.assertEqual(service_app._normalize_language_hint(" zh-CN "), "zh")
        self.assertIsNone(service_app._normalize_language_hint("auto"))
        self.assertIsNone(service_app._normalize_language_hint("default"))
        self.assertIsNone(service_app._normalize_language_hint(""))

    async def test_skips_tiny_audio_chunks_without_loading_model(self) -> None:
        original_get_model = service_app._get_model
        try:
            service_app._get_model = lambda: self.fail("model should not be loaded")
            response = await service_app.transcribe(FakeUpload(b"0" * 128), language="en-US")
        finally:
            service_app._get_model = original_get_model

        self.assertEqual(json.loads(response.body), {"text": ""})

    async def test_skips_recoverable_moov_atom_decoder_errors(self) -> None:
        original_get_model = service_app._get_model
        try:
            service_app._get_model = lambda: FakeModel(RuntimeError("moov atom not found"))
            response = await service_app.transcribe(FakeUpload(b"0" * 2048), language="en-US")
        finally:
            service_app._get_model = original_get_model

        self.assertEqual(json.loads(response.body), {"text": ""})


if __name__ == "__main__":
    unittest.main()
