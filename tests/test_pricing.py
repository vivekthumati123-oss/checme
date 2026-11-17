import pytest

from shop.pricing import apply_discount


def test_apply_discount_percentage():
    assert apply_discount(200, 25) == 150


def test_apply_discount_zero_percent():
    assert apply_discount(80, 0) == 80


@pytest.mark.parametrize("pct", [-1, 101])
def test_apply_discount_rejects_out_of_range(pct):
    with pytest.raises(ValueError):
        apply_discount(10, pct)
