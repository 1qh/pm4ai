/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- typed JSON boundary: each caller declares the parsed shape */
/** biome-ignore lint/nursery/noUnsafeTypeAssertion: single validated JSON parse boundary */
const parseJson = <T>(text: string): T => JSON.parse(text) as T
export { parseJson }
