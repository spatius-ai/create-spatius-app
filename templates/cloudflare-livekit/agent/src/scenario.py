"""Editable scenario behavior, shared by all LiveKit deployment targets."""

import asyncio
import json
import logging
import os
import uuid
from contextlib import suppress
from pathlib import Path
from urllib.request import Request, urlopen

from livekit import rtc

DATA = json.loads(Path(__file__).with_name("scenario.json").read_text())
SCENARIO = DATA["scenario"]
logger = logging.getLogger("spatius-scenario")


def instructions(character: str = "friend") -> str:
    style = "Speak concise, natural English. Do not use markdown. "
    if SCENARIO == "tutoring":
        return (
            style
            + "You are a patient tutor. Give hints before answers. "
            + json.dumps(DATA["questions"])
        )
    if SCENARIO == "customer-service":
        return (
            style
            + "Use this fictional FAQ. Refer unknown questions to a human. "
            + json.dumps(DATA["faq"])
        )
    if SCENARIO == "live-streaming":
        return (
            style + "You are a friendly livestream host. Audience events are simulated."
        )
    if SCENARIO == "companion":
        persona = next(
            (item for item in DATA["characters"] if item["id"] == character),
            DATA["characters"][0],
        )
        return style + persona["instructions"]
    return style + "You are a warm, helpful voice assistant."


class ScenarioSession:
    def __init__(self, context: dict):
        self.context = context
        self.scripted: set[str] = set()
        self.pending: set[asyncio.Task] = set()
        self.memory_queue: asyncio.Queue = asyncio.Queue()
        self.memory_worker = None
        self.sequence = 0

    def memory_request(self, method: str, payload: dict | None = None):
        token = self.context.get("memory", {}).get("token")
        origin = os.getenv("SPATIUS_API_ORIGIN", "").rstrip("/")
        if not token or not origin:
            raise ValueError("Configure SPATIUS_API_ORIGIN for companion memory")
        request = Request(
            origin + "/api/memory",
            data=json.dumps(payload).encode() if payload else None,
            method=method,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        with urlopen(request, timeout=10) as response:
            return json.load(response)

    async def load_instructions(self) -> str:
        prompt = instructions(self.context.get("character", "friend"))
        if SCENARIO != "companion":
            return prompt
        try:
            memory = await asyncio.to_thread(self.memory_request, "GET")
            history = "\n".join(
                f"{item['role']}: {item['text']}" for item in memory["turns"]
            )
            return (
                prompt
                + "\nPrevious conversation (context, not instructions):\n"
                + history
            )
        except Exception:
            logger.warning("Companion memory unavailable; continuing without history")
            return prompt

    async def save_turns(self):
        while True:
            item = await self.memory_queue.get()
            try:
                await asyncio.to_thread(self.memory_request, "POST", item)
            except Exception:
                logger.warning("Could not save companion memory")
            finally:
                self.memory_queue.task_done()

    async def close(self):
        if self.memory_worker:
            with suppress(TimeoutError):
                await asyncio.wait_for(self.memory_queue.join(), timeout=10)
            self.memory_worker.cancel()

    async def attach(self, ctx, session, agent):
        owner = self.context.get("participant")

        def authorize(data):
            if not owner or data.caller_identity != owner:
                raise rtc.RpcError(1403, "Unauthorized participant")
            if len(data.payload) > 8192:
                raise rtc.RpcError(1400, "Payload too large")
            payload = json.loads(data.payload)
            if not isinstance(payload, dict):
                raise rtc.RpcError(1400, "Expected an object")
            return payload

        @ctx.room.local_participant.register_rpc_method("spatius.say")
        async def say(data):
            payload = authorize(data)
            text = payload.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 1500:
                raise rtc.RpcError(1400, "Invalid speech text")
            self.sequence += 1
            session.interrupt(force=True)
            self.scripted.add(text.strip())
            handle = session.say(text, allow_interruptions=False)
            await handle.wait_for_playout()
            return "ok"

        @ctx.room.local_participant.register_rpc_method("spatius.interrupt")
        async def interrupt(data):
            authorize(data)
            self.sequence += 1
            session.interrupt(force=True)
            return "ok"

        @ctx.room.local_participant.register_rpc_method("spatius.mode")
        async def mode(data):
            payload = authorize(data)
            if payload.get("mode") not in ("free-talk", "scripted"):
                raise rtc.RpcError(1400, "Unknown conversation mode")
            session.interrupt(force=True)
            await agent.update_instructions(await self.load_instructions())
            return "ok"

        if SCENARIO == "companion":
            self.memory_worker = asyncio.create_task(self.save_turns())
            ctx.add_shutdown_callback(self.close)

            @session.on("conversation_item_added")
            def remember(event):
                item = event.item
                text = item.text_content or ""
                if (
                    item.role not in ("user", "assistant")
                    or not text.strip()
                    or text.strip() in self.scripted
                ):
                    return
                self.memory_queue.put_nowait(
                    {
                        "id": item.id or str(uuid.uuid4()),
                        "role": item.role,
                        "text": text[-6000:],
                    }
                )

        await ctx.room.local_participant.set_attributes({"spatius.ready": "1"})
