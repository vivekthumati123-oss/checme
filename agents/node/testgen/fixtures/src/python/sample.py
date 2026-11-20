from typing import List


def normalize_tags(tags: List[str]) -> List[str]:
    cleaned: List[str] = []
    for tag in tags:
        trimmed = tag.strip().lower()
        if trimmed and trimmed not in cleaned:
            cleaned.append(trimmed)
    return cleaned


class InvoiceCalculator:
    def __init__(self, discount_rate: float = 0.0) -> None:
        self.discount_rate = discount_rate

    def compute_total(self, amounts: List[float]) -> float:
        if any(a < 0 for a in amounts):
            raise ValueError("negative amount")
        subtotal = sum(amounts)
        return round(subtotal * (1.0 - self.discount_rate), 2)

