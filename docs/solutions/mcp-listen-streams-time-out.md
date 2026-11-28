# MCP requests that hit Vercel's 300s timeout

**Date**: 2026-11-24

## The problem
Production logs showed `POST /api/mcp` requests timing out at 300s, while every voice count worked.

## The solution / decision
The timeouts were `subscriptions/listen` calls, not tool calls. MCP SDK v2 advertises `tools.listChanged: true` by default, and a client that listens for changes gets an SSE stream held open until Vercel kills it. The tools never change while deployed, so `src/app/api/mcp/route.ts` sets both:
- `capabilities: { tools: { listChanged: false } }`, so clients aren't invited to listen.
- `maxSubscriptions: 0`, so a client that listens anyway gets a JSON error (-32603) right away.

## Why it wasn't obvious
- Turning off the advertisement alone looks like a fix, but `subscriptions/listen` still opens a stream for any client that calls it. A review caught this after the first attempt.
- A 2025-era `tools/list` probe never opens the stream. It only reproduces with protocol `2026-07-28` and the `_meta` fields in the test.
- `MCP_ACCESS_TOKEN` is set only for Production, so previews can't confirm how Claude behaves. Check the production logs after a deploy.

## Pointers
- `src/app/api/mcp/route.ts`, `src/app/api/mcp/route.test.ts`
- `vercel logs --no-branch --environment production --since 30m --json` (without `--no-branch` it filters to the current git branch and looks empty)
