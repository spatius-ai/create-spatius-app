import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.dispatch_metadata import DispatchMetadataError

# Import the real entrypoint without loading local development credentials.
with patch("dotenv.load_dotenv"):
    from src import agent as agent_module


class AgentStartupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.events: list[str] = []
        self.connected = False
        self.room = SimpleNamespace(name="test-room")
        self.browser_joined = asyncio.Event()
        self.browser_joined.set()
        self.waiting_for_browser = asyncio.Event()
        self.ctx = SimpleNamespace(
            room=self.room,
            job=SimpleNamespace(
                metadata=json.dumps({"version": 1, "avatar": {"id": "avatar-test"}})
            ),
            connect=AsyncMock(side_effect=self.connect),
            wait_for_participant=AsyncMock(side_effect=self.wait_for_browser),
        )
        self.session = SimpleNamespace(
            start=AsyncMock(side_effect=self.start_session),
            say=AsyncMock(side_effect=self.say_greeting),
        )
        self.avatar = SimpleNamespace(start=AsyncMock(side_effect=self.start_avatar))
        self.session_factory = self.enterContext(
            patch.object(agent_module, "AgentSession", return_value=self.session)
        )
        self.avatar_factory = self.enterContext(
            patch.object(
                agent_module.spatius, "AvatarSession", return_value=self.avatar
            )
        )
        self.assistant_factory = self.enterContext(
            patch.object(agent_module, "Assistant")
        )
        self.inference = self.enterContext(patch.object(agent_module, "inference"))
        self.bvc = self.enterContext(
            patch.object(agent_module.noise_cancellation, "BVC")
        )
        self.enterContext(patch.object(agent_module, "TurnHandlingOptions"))

    async def connect(self) -> None:
        # Ensure startup waits for connection completion, not just invocation.
        await asyncio.sleep(0)
        self.connected = True
        self.events.append("connect")

    async def start_avatar(self, session, *, room) -> None:
        self.assertTrue(self.connected, "Spatius started before the room connected")
        self.assertIs(session, self.session)
        self.assertIs(room, self.room)
        await asyncio.sleep(0)
        self.events.append("avatar")

    async def start_session(self, *, agent, room, room_options) -> None:
        self.assertEqual(self.events, ["connect", "avatar"])
        self.assertIs(agent, self.assistant_factory.return_value)
        self.assertIs(room, self.room)
        self.assertIs(
            room_options.audio_input.noise_cancellation, self.bvc.return_value
        )
        self.events.append("session")

    async def wait_for_browser(self, *, kind):
        self.assertEqual(
            kind, agent_module.rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD
        )
        self.assertEqual(self.events, ["connect", "avatar", "session"])
        self.waiting_for_browser.set()
        await self.browser_joined.wait()
        self.events.append("browser")

    async def say_greeting(self, text, *, allow_interruptions) -> None:
        self.assertEqual(self.events, ["connect", "avatar", "session", "browser"])
        self.assertTrue(allow_interruptions)
        self.events.append("greeting")

    async def test_connects_before_avatar_and_voice_session_startup(self) -> None:
        await agent_module.spatius_agent(self.ctx)

        self.assertEqual(
            self.events, ["connect", "avatar", "session", "browser", "greeting"]
        )
        self.session.say.assert_awaited_once_with(
            "Hi! I'm here to help. What would you like to talk about?",
            allow_interruptions=True,
        )
        self.ctx.connect.assert_awaited_once_with()
        self.avatar_factory.assert_called_once_with(avatar_id="avatar-test")
        self.avatar.start.assert_awaited_once_with(self.session, room=self.room)
        self.session.start.assert_awaited_once_with(
            agent=self.assistant_factory.return_value,
            room=self.room,
            room_options=self.session.start.call_args.kwargs["room_options"],
        )
        self.bvc.assert_called_once_with()
        self.inference.TTS.assert_called_once_with(
            model="cartesia/sonic-3.6",
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
            language="en",
        )
        self.assertTrue(self.session_factory.call_args.kwargs["expressive"])
        self.assertTrue(
            self.session_factory.call_args.kwargs["use_tts_aligned_transcript"]
        )

    async def test_connection_failure_prevents_avatar_and_voice_startup(self) -> None:
        self.ctx.connect.side_effect = ConnectionError("room connection failed")

        with self.assertRaisesRegex(ConnectionError, "room connection failed"):
            await agent_module.spatius_agent(self.ctx)

        self.avatar_factory.assert_not_called()
        self.avatar.start.assert_not_awaited()
        self.session.start.assert_not_awaited()

    async def test_connection_cancellation_prevents_avatar_and_voice_startup(
        self,
    ) -> None:
        self.ctx.connect.side_effect = asyncio.CancelledError()

        with self.assertRaises(asyncio.CancelledError):
            await agent_module.spatius_agent(self.ctx)

        self.avatar_factory.assert_not_called()
        self.avatar.start.assert_not_awaited()
        self.session.start.assert_not_awaited()

    async def test_invalid_metadata_is_rejected_before_connecting(self) -> None:
        self.ctx.job.metadata = "invalid-json"

        with self.assertRaises(DispatchMetadataError):
            await agent_module.spatius_agent(self.ctx)

        self.ctx.connect.assert_not_awaited()
        self.session_factory.assert_not_called()
        self.avatar_factory.assert_not_called()

    async def test_avatar_failure_prevents_voice_session_startup(self) -> None:
        self.avatar.start.side_effect = RuntimeError("avatar startup failed")

        with self.assertRaisesRegex(RuntimeError, "avatar startup failed"):
            await agent_module.spatius_agent(self.ctx)

        self.ctx.connect.assert_awaited_once_with()
        self.session.start.assert_not_awaited()
        self.session.say.assert_not_awaited()

    async def test_session_failure_does_not_greet(self) -> None:
        self.session.start.side_effect = RuntimeError("session startup failed")
        with self.assertRaisesRegex(RuntimeError, "session startup failed"):
            await agent_module.spatius_agent(self.ctx)
        self.session.say.assert_not_awaited()

    async def test_slow_browser_delays_greeting_until_it_joins(self) -> None:
        self.browser_joined.clear()
        task = asyncio.create_task(agent_module.spatius_agent(self.ctx))
        try:
            await asyncio.wait_for(self.waiting_for_browser.wait(), timeout=1)
            self.session.start.assert_awaited_once()
            self.avatar.start.assert_awaited_once()
            self.session.say.assert_not_awaited()
            self.browser_joined.set()
            await asyncio.wait_for(task, timeout=1)
            self.session.say.assert_awaited_once()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_cancellation_while_waiting_never_greets(self) -> None:
        self.browser_joined.clear()
        task = asyncio.create_task(agent_module.spatius_agent(self.ctx))
        try:
            await asyncio.wait_for(self.waiting_for_browser.wait(), timeout=1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.session.say.assert_not_awaited()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_uses_the_business_layer_selected_masculine_voice(self) -> None:
        voice_id = "a167e0f3-df7e-4d52-a9c3-f949145efdab"
        self.ctx.job.metadata = json.dumps(
            {
                "version": 1,
                "avatar": {"id": "avatar-test"},
                "voice": {"id": voice_id},
            }
        )
        await agent_module.spatius_agent(self.ctx)
        self.inference.TTS.assert_called_once_with(
            model="cartesia/sonic-3.6",
            voice=voice_id,
            language="en",
        )


class DevReadinessTests(unittest.TestCase):
    def test_registration_writes_only_the_supervisors_ready_file(self) -> None:
        with (
            patch.dict(
                "os.environ", {"SPATIUS_DEV_READY_FILE": "/tmp/test-agent-ready"}
            ),
            patch.object(agent_module, "Path") as path,
        ):
            agent_module.server.emit("worker_registered", "worker-test", object())
        path.assert_called_once_with("/tmp/test-agent-ready")
        path.return_value.touch.assert_called_once_with()

    def test_standalone_agent_does_not_write_a_ready_file(self) -> None:
        with (
            patch.dict("os.environ", {}, clear=True),
            patch.object(agent_module, "Path") as path,
        ):
            agent_module.server.emit("worker_registered", "worker-test", object())
        path.assert_not_called()


if __name__ == "__main__":
    unittest.main()
