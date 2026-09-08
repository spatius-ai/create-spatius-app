import json
from dataclasses import dataclass, field

AGENT_DISPATCH_METADATA_VERSION = 1
DEFAULT_VOICE_ID = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"  # Jacqueline


class DispatchMetadataError(ValueError):
    """Raised when LiveKit dispatch metadata does not match the contract."""


@dataclass(frozen=True)
class AgentDispatchMetadata:
    avatar_id: str
    context: dict = field(default_factory=dict)
    voice_id: str = DEFAULT_VOICE_ID


def parse_agent_dispatch_metadata(raw_metadata: str) -> AgentDispatchMetadata:
    if not raw_metadata:
        raise DispatchMetadataError("Agent dispatch metadata is required.")

    try:
        payload = json.loads(raw_metadata)
    except json.JSONDecodeError as error:
        raise DispatchMetadataError(
            "Agent dispatch metadata must be valid JSON."
        ) from error

    if not isinstance(payload, dict):
        raise DispatchMetadataError("Agent dispatch metadata must be a JSON object.")

    version = payload.get("version")
    if type(version) is not int or version != AGENT_DISPATCH_METADATA_VERSION:
        raise DispatchMetadataError(
            f"Unsupported agent dispatch metadata version: {version!r}."
        )

    avatar = payload.get("avatar")
    if not isinstance(avatar, dict):
        raise DispatchMetadataError(
            "Agent dispatch metadata must include an avatar object."
        )

    avatar_id = avatar.get("id")
    if not isinstance(avatar_id, str) or not avatar_id.strip():
        raise DispatchMetadataError(
            "Agent dispatch metadata must include a non-empty avatar.id."
        )

    # Optional in v1 so older Workers keep their original standard female voice.
    voice_id = DEFAULT_VOICE_ID
    if "voice" in payload:
        voice = payload["voice"]
        if not isinstance(voice, dict):
            raise DispatchMetadataError(
                "Agent dispatch metadata voice must be an object."
            )
        voice_id = voice.get("id")
        if not isinstance(voice_id, str) or not voice_id.strip():
            raise DispatchMetadataError(
                "Agent dispatch metadata needs a non-empty voice.id."
            )

    context = payload.get("context", {})
    if not isinstance(context, dict):
        raise DispatchMetadataError("Context must be an object.")
    if "participant" in context and (
        not isinstance(context["participant"], str) or not context["participant"]
    ):
        raise DispatchMetadataError("Invalid participant identity.")
    return AgentDispatchMetadata(
        avatar_id=avatar_id.strip(), voice_id=voice_id.strip(), context=context
    )
