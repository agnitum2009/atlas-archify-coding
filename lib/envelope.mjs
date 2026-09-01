// Unified receipt envelope (command-contract.md v1.0.0).

export function ok(command, data) {
  return { schemaVersion: 1, command, status: 'ok', data };
}

export function failed(command, diagnostics, data) {
  const receipt = { schemaVersion: 1, command, status: 'failed', diagnostics };
  if (data !== undefined) receipt.data = data;
  return receipt;
}

