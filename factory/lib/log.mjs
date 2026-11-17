export function logLine(fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }))
}
