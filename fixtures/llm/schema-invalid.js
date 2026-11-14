export default function () {
  // Missing required `content` string triggers SubmitTestsArgsSchema parse error
  return {
    wrongKey: "missing content field intentionally",
  };
}

