Deno.serve((req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.onopen = () => console.log("接続されました");
    socket.onmessage = (e) => {
      console.log("受信:", e.data);
      socket.send(`echo: ${e.data}`);
    };
    return response;
  }

  return new Response("サーバー起動中");
});
