### Java Addendum

- Write **JUnit 5** tests (`org.junit.jupiter.api.Test`, `org.junit.jupiter.api.Assertions.*`). Never use JUnit 4 (`org.junit.Test`, `@RunWith`).
- Declare the exact `package` statement matching `conventions.importHint` and match the public test class name to the filename stem (`testClassName`).
- Only use `org.mockito.Mockito` if Mockito is listed in `mockingLibs`; otherwise write direct POJO / constructor-based unit tests without external mocking frameworks.
- Cover normal return values, boundary inputs, and `Assertions.assertThrows(...)` paths.

