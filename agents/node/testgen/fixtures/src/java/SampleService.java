package com.example.billing;

import java.util.List;

public class SampleService {
    private final double taxRate;

    public SampleService(double taxRate) {
        this.taxRate = taxRate;
    }

    public double computeTotal(List<Double> items) {
        double sum = 0.0;
        for (Double item : items) {
            if (item == null || item < 0.0) {
                throw new IllegalArgumentException("Invalid item");
            }
            sum += item;
        }
        return sum * (1.0 + this.taxRate);
    }

    public boolean isDiscountEligible(int itemCount) {
        return itemCount >= 5;
    }
}

