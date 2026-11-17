package com.acme.orders;

// Interface with an abstract method only: must be skipped.
public interface ShippingPolicy {
    double cost(double weightKg);
}
