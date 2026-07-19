# SPDX-License-Identifier: Apache-2.0
"""Minimal phone-call app using NEST libraries.

Run:
    uv run python scripts/phone_call_app.py
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from nest_plugins_reference.comms.nest_native import NestNativeComms
from nest_plugins_reference.registry.in_memory import InMemoryRegistry
from nest_plugins_reference.transport.in_memory import (
    InMemoryNetwork,
    StandaloneInMemoryTransport,
)
from nest_sdk import AgentCard, AgentId, Message, MessageId, Query


@dataclass(frozen=True)
class PhoneDirectoryEntry:
    """A discovered phone endpoint."""

    agent_id: AgentId
    phone_number: str


class PhoneAgent:
    """Phone-capable agent that can place and receive calls."""

    def __init__(
        self,
        agent_id: AgentId,
        phone_number: str,
        network: InMemoryNetwork,
        registry: InMemoryRegistry,
    ) -> None:
        self.agent_id = agent_id
        self.phone_number = phone_number
        self._transport = StandaloneInMemoryTransport(agent_id, network)
        self._comms = NestNativeComms(agent_id, transport=self._transport, registry=registry)
        self._session_counter = 0

    async def advertise(self) -> None:
        """Publish this phone endpoint to the registry."""
        card = AgentCard(
            agent_id=self.agent_id,
            name=f"phone:{self.phone_number}",
            capabilities=["phone.call", "phone.receive"],
            metadata={"phone_number": self.phone_number},
        )
        await self._comms.advertise(card)

    async def discover_phone(self, phone_number: str) -> PhoneDirectoryEntry:
        """Resolve a phone number to an agent ID."""
        cards = await self._comms.discover(Query(capabilities=["phone.receive"]))
        for card in cards:
            if card.metadata.get("phone_number") == phone_number:
                return PhoneDirectoryEntry(agent_id=card.agent_id, phone_number=phone_number)
        msg = f"no phone endpoint found for number {phone_number}"
        raise LookupError(msg)

    async def receive_once(self) -> dict[str, Any]:
        """Receive exactly one message from transport and decode it."""
        _sender, raw = await self._transport.receive()
        msg = self._comms.deserialize(raw)
        return msg.metadata

    async def handle_incoming_call(self) -> None:
        """Receive one full incoming call, then hang up."""
        _sender, raw_offer = await self._transport.receive()
        offer = self._comms.deserialize(raw_offer)
        if offer.metadata.get("kind") != "phone.call.offer":
            raise RuntimeError("expected phone.call.offer")

        session_id = str(offer.metadata["session_id"])
        caller_number = str(offer.metadata["from_number"])
        print(f"{self.agent_id} ringing from {caller_number} (session={session_id})")

        accept = Message(
            id=MessageId(f"{self.agent_id}-accept-{session_id}"),
            sender=self.agent_id,
            receiver=offer.sender,
            payload=b"accept",
            metadata={
                "kind": "phone.call.accept",
                "session_id": session_id,
                "from_number": self.phone_number,
            },
        )
        await self._comms.send(offer.sender, accept)
        print(f"{self.agent_id} accepted call from {caller_number}")

        while True:
            _sender, raw = await self._transport.receive()
            msg = self._comms.deserialize(raw)
            kind = str(msg.metadata.get("kind"))

            if kind == "phone.voice.frame":
                frame_text = msg.payload.decode("utf-8")
                print(f"{self.agent_id} heard: {frame_text}")
                continue

            if kind == "phone.call.end":
                print(f"{self.agent_id} call ended (session={session_id})")
                break

            raise RuntimeError(f"unexpected message kind: {kind}")

    async def place_call(self, target_number: str, voice_frames: list[str]) -> None:
        """Dial another phone agent and stream voice frames."""
        target = await self.discover_phone(target_number)
        self._session_counter += 1
        session_id = f"{self.agent_id}-{self._session_counter}"

        offer = Message(
            id=MessageId(f"{self.agent_id}-offer-{self._session_counter}"),
            sender=self.agent_id,
            receiver=target.agent_id,
            payload=b"ring",
            metadata={
                "kind": "phone.call.offer",
                "session_id": session_id,
                "from_number": self.phone_number,
                "to_number": target.phone_number,
            },
        )
        await self._comms.send(target.agent_id, offer)
        print(f"{self.agent_id} dialing {target_number} (session={session_id})")

        _sender, raw_ack = await self._transport.receive()
        ack = self._comms.deserialize(raw_ack)
        if ack.metadata.get("kind") != "phone.call.accept":
            raise RuntimeError("expected phone.call.accept")
        print(f"{self.agent_id} call connected to {target_number}")

        for idx, frame in enumerate(voice_frames, start=1):
            packet = Message(
                id=MessageId(f"{self.agent_id}-frame-{self._session_counter}-{idx}"),
                sender=self.agent_id,
                receiver=target.agent_id,
                payload=frame.encode("utf-8"),
                metadata={
                    "kind": "phone.voice.frame",
                    "session_id": session_id,
                    "frame": idx,
                },
            )
            await self._comms.send(target.agent_id, packet)

        hangup = Message(
            id=MessageId(f"{self.agent_id}-end-{self._session_counter}"),
            sender=self.agent_id,
            receiver=target.agent_id,
            payload=b"hangup",
            metadata={"kind": "phone.call.end", "session_id": session_id},
        )
        await self._comms.send(target.agent_id, hangup)
        print(f"{self.agent_id} hung up (session={session_id})")


async def main() -> None:
    """Demo: two agents call each other over NEST transport/comms."""
    network = InMemoryNetwork()
    registry = InMemoryRegistry()

    alice = PhoneAgent(AgentId("alice"), "+1-202-555-0001", network, registry)
    bob = PhoneAgent(AgentId("bob"), "+1-202-555-0002", network, registry)

    await alice.advertise()
    await bob.advertise()

    bob_listener = asyncio.create_task(bob.handle_incoming_call())
    await alice.place_call(
        target_number="+1-202-555-0002",
        voice_frames=["Hi Bob, can you hear me?", "Let us sync after lunch."],
    )
    await bob_listener

    alice_listener = asyncio.create_task(alice.handle_incoming_call())
    await bob.place_call(
        target_number="+1-202-555-0001",
        voice_frames=["Loud and clear, Alice.", "Calling you back now."],
    )
    await alice_listener

    print("Phone demo complete.")


if __name__ == "__main__":
    asyncio.run(main())