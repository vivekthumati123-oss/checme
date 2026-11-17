def forward(schema: dict) -> dict:
    if "orders" in schema:
        return schema
    schema["orders"] = {"columns": ["id", "total"]}
    return schema
