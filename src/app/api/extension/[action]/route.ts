// Caminho antigo da ponte loopback: sempre recusado. A extensão usa /api/companion.
export function POST() { return Response.json({ error: "Use /api/companion." }, { status: 403 }); }
