// A ponte não é publicada na porta da interface, que pode estar exposta à LAN.
export function POST() { return Response.json({ error: "Use a ponte loopback dedicada." }, { status: 403 }); }
