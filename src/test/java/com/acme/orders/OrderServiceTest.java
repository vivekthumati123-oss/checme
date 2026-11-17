package com.acme.orders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class OrderServiceTest {

    private final OrderService service = new OrderService();

    @Test
    void totalAddsTaxAndRoundsToCents() {
        assertThat(service.total(100.0, 0.2)).isEqualTo(120.0);
        assertThat(service.total(19.99, 0.075)).isEqualTo(21.49);
    }

    @Test
    void totalRejectsNegativeSubtotal() {
        assertThrows(IllegalArgumentException.class, () -> service.total(-1.0, 0.2));
    }
}
