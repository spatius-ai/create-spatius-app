import json
import unittest

from src.dispatch_metadata import (
    AGENT_DISPATCH_METADATA_VERSION,
    DEFAULT_VOICE_ID,
    DispatchMetadataError,
    parse_agent_dispatch_metadata,
)


class AgentDispatchMetadataTests(unittest.TestCase):
    def test_parses_avatar_id(self) -> None:
        metadata = parse_agent_dispatch_metadata(
            json.dumps(
                {
                    "version": AGENT_DISPATCH_METADATA_VERSION,
                    "avatar": {"id": "avatar-123"},
                }
            )
        )

        self.assertEqual(metadata.avatar_id, "avatar-123")
        self.assertEqual(metadata.voice_id, DEFAULT_VOICE_ID)

    def test_parses_selected_voice(self) -> None:
        for voice_id in [DEFAULT_VOICE_ID, "a167e0f3-df7e-4d52-a9c3-f949145efdab"]:
            with self.subTest(voice_id=voice_id):
                metadata = parse_agent_dispatch_metadata(
                    json.dumps(
                        {
                            "version": 1,
                            "avatar": {"id": "avatar-123"},
                            "voice": {"id": voice_id},
                        }
                    )
                )
                self.assertEqual(metadata.voice_id, voice_id)

    def test_rejects_invalid_voice_without_silently_using_a_different_voice(
        self,
    ) -> None:
        for voice in [None, "masculine", {}, {"id": " "}, {"id": 123}]:
            with self.subTest(voice=voice), self.assertRaises(DispatchMetadataError):
                parse_agent_dispatch_metadata(
                    json.dumps(
                        {
                            "version": 1,
                            "avatar": {"id": "avatar-123"},
                            "voice": voice,
                        }
                    )
                )

    def test_allows_future_optional_fields(self) -> None:
        metadata = parse_agent_dispatch_metadata(
            json.dumps(
                {
                    "version": AGENT_DISPATCH_METADATA_VERSION,
                    "avatar": {"id": "avatar-123", "style": "friendly"},
                    "session": {"locale": "en-US"},
                }
            )
        )

        self.assertEqual(metadata.avatar_id, "avatar-123")

    def test_rejects_invalid_json(self) -> None:
        with self.assertRaisesRegex(DispatchMetadataError, "valid JSON"):
            parse_agent_dispatch_metadata("not-json")

    def test_rejects_unsupported_version(self) -> None:
        with self.assertRaisesRegex(DispatchMetadataError, "Unsupported"):
            parse_agent_dispatch_metadata(
                json.dumps({"version": 2, "avatar": {"id": "avatar-123"}})
            )

    def test_rejects_missing_avatar_id(self) -> None:
        with self.assertRaisesRegex(DispatchMetadataError, "avatar.id"):
            parse_agent_dispatch_metadata(
                json.dumps({"version": AGENT_DISPATCH_METADATA_VERSION, "avatar": {}})
            )

    def test_rejects_blank_avatar_id(self) -> None:
        with self.assertRaisesRegex(DispatchMetadataError, "avatar.id"):
            parse_agent_dispatch_metadata(
                json.dumps(
                    {
                        "version": AGENT_DISPATCH_METADATA_VERSION,
                        "avatar": {"id": "   "},
                    }
                )
            )


if __name__ == "__main__":
    unittest.main()
