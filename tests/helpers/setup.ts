// No test may reach the network (SC-004, FR-064). Commands get a fake fetch through their
// context; anything that falls back to the global one fails loudly instead.
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input)
  throw new Error(`Tests must not use the network (global fetch called for ${url})`)
}
