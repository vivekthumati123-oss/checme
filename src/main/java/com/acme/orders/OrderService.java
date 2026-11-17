package com.acme.orders;

public class OrderService {

    private static final double CENTS = 100.0;

    public double total(double subtotal, double taxRate) {
        if (subtotal < 0) {
            throw new IllegalArgumentException("subtotal must be >= 0");
        }
        return Math.round(subtotal * (1 + taxRate) * CENTS) / CENTS;
    }
}
