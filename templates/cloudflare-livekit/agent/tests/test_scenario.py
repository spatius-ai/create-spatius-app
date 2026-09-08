import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from livekit import rtc

from src.scenario import ScenarioSession


class ScenarioTests(unittest.IsolatedAsyncioTestCase):
    async def test_rpc_checks_owner_and_publishes_readiness_last(self):
        methods = {}
        events = []

        def register(name):
            def decorate(method):
                methods[name] = method
                events.append(name)
                return method

            return decorate

        async def attributes(value):
            self.assertEqual(len(methods), 3)
            events.append(value)

        participant = SimpleNamespace(
            register_rpc_method=register, set_attributes=attributes
        )
        ctx = SimpleNamespace(room=SimpleNamespace(local_participant=participant))
        session = SimpleNamespace(interrupt=lambda **_: None)
        scenario = ScenarioSession({"participant": "owner"})
        with patch("src.scenario.SCENARIO", "tutoring"):
            await scenario.attach(
                ctx, session, SimpleNamespace(update_instructions=AsyncMock())
            )
        self.assertEqual(events[-1], {"spatius.ready": "1"})
        with self.assertRaises(rtc.RpcError):
            await methods["spatius.interrupt"](
                SimpleNamespace(caller_identity="stranger", payload="{}")
            )
        self.assertEqual(
            await methods["spatius.interrupt"](
                SimpleNamespace(caller_identity="owner", payload="{}")
            ),
            "ok",
        )

    async def test_unavailable_memory_does_not_prevent_conversation(self):
        scenario = ScenarioSession({})
        with patch("src.scenario.SCENARIO", "companion"):
            prompt = await scenario.load_instructions()
        self.assertIn("friend", prompt)
