from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Dict, List, Optional


class InsufficientStock(Exception):
    """Raised when more units are requested than are in stock."""


def parse_sku(raw: Optional[str]) -> str:
    if raw is None:
        raise ValueError("sku required")
    cleaned = raw.strip().upper()
    if not cleaned:
        raise ValueError("sku required")
    if len(cleaned) > 12:
        cleaned = cleaned[:12]
    return cleaned.replace(" ", "-")


class Inventory:
    def __init__(self, initial: Optional[Dict[str, int]] = None):
        self._stock: Dict[str, int] = {}
        for sku, qty in (initial or {}).items():
            if qty < 0:
                raise ValueError(f"negative quantity for {sku}")
            self._stock[parse_sku(sku)] = qty

    def add(self, sku: str, qty: int) -> int:
        if qty <= 0:
            raise ValueError("qty must be positive")
        key = parse_sku(sku)
        self._stock[key] = self._stock.get(key, 0) + qty
        return self._stock[key]

    def remove(self, sku: str, qty: int) -> int:
        key = parse_sku(sku)
        have = self._stock.get(key, 0)
        if qty > have:
            raise InsufficientStock(f"{key}: have {have}, need {qty}")
        self._stock[key] = have - qty
        return self._stock[key]

    @property
    def total_units(self) -> int:
        return sum(self._stock.values())

    def __repr__(self) -> str:
        return f"Inventory({self._stock!r})"

    def low_stock(self, threshold: int = 5) -> List[str]:
        return sorted(sku for sku, qty in self._stock.items() if qty < threshold)

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self._stock, fh, sort_keys=True)

    @classmethod
    def load(cls, path: str) -> "Inventory":
        with open(path, "r", encoding="utf-8") as fh:
            return cls(json.load(fh))


class Reorderable(ABC):
    @abstractmethod
    def reorder_point(self) -> int:
        """Abstract: must be skipped."""


async def reserve(client, sku: str, qty: int) -> bool:
    """`client` is any object with an async `hold(sku, qty) -> bool` method."""
    if qty <= 0:
        return False
    try:
        return bool(await client.hold(parse_sku(sku), qty))
    except TimeoutError:
        return False


def legacy_checksum(sku: str) -> int:  # pragma: no cover
    return sum(ord(c) for c in sku) % 97


def outer(x: int) -> int:
    def inner(y: int) -> int:  # nested: must not be extracted
        return y * 2

    return inner(x) + 1
