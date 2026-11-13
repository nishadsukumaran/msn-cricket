import "reflect-metadata";
import { performance } from "node:perf_hooks";
import { observeRequest } from "./metrics.ts";
import { PRDController, registrationImage } from "./prd-controller.ts";
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  Module,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Server } from "socket.io";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CommerceService } from "./commerce.ts";
import { uploadPhoto } from "./storage.ts";
import { AuctionService } from "./service.ts";
import { PreparationService } from "./preparation.ts";
import {
  actorFor,
  exchangeIdentity,
  sessionCookie,
  hashToken,
  beginLogin,
  finishLogin,
} from "./auth.ts";
import { pool, transaction } from "../../../packages/database/src/db.ts";
const auction = new AuctionService(),
  preparation = new PreparationService(),
  commerce = new CommerceService();
const uuid = (id: string) => z.string().uuid().parse(id);
export const localLogin = () =>
  process.env.ENABLE_REHEARSAL_LOGIN === "true" &&
  process.env.NODE_ENV !== "production";
async function fixture() {
  if (!localLogin()) throw Error("NOT_FOUND");
  return JSON.parse(await readFile("artifacts/rehearsal.json", "utf8"));
}
@Catch()
class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const code =
      error instanceof z.ZodError
        ? "INVALID_INPUT"
        : error.code === "23505"
          ? "CONFLICT"
          : error.code === "23503"
            ? "INVALID_REFERENCE"
            : (error.message ?? "INTERNAL_ERROR");
    const safe = /^[A-Z_]+(?::[A-Z_,]+)?$/.test(code) ? code : "INTERNAL_ERROR";
    const status =
      safe === "UNAUTHENTICATED"
        ? 401
        : ["FORBIDDEN", "NOT_OPERATOR"].includes(safe)
          ? 403
          : safe === "NOT_FOUND"
            ? 404
            : safe === "INTERNAL_ERROR"
              ? 500
              : 409;
    if (status === 500)
      console.error(
        JSON.stringify({
          level: "error",
          message: error.message,
          code: error.code,
        }),
      );
    res.status(status).json({
      code: safe,
      retryable: ["STALE_VERSION", "RESYNC_REQUIRED"].includes(safe),
    });
  }
}
@Controller("api")
class API {
  @Get("billing/products") products() {
    return commerce.products();
  }
  @Post("billing/checkout") async checkout(@Req() r: any, @Body() b: any) {
    return commerce.checkout(await actorFor(r.headers.cookie), b);
  }
  @Post("billing/webhooks/razorpay") async webhook(@Req() r: any) {
    return commerce.webhook(
      r.rawBody,
      r.headers["x-razorpay-signature"] ?? "",
      r.headers["x-razorpay-event-id"] ?? "",
    );
  }
  @Post("platform/credit-grants") async grant(@Req() r: any, @Body() b: any) {
    return commerce.manualGrant(await actorFor(r.headers.cookie), b);
  }
  @Post("photos") async photo(@Req() r: any, @Body() b: any) {
    const actor = await actorFor(r.headers.cookie);
    const bytes = z
      .string()
      .max(7_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .parse(b.base64);
    return uploadPhoto(actor, Buffer.from(bytes, "base64"));
  }
  @Get("photos/:registration") async photoRead(
    @Req() r: any,
    @Param("registration") registration: string,
    @Query("display") display: string,
    @Res() res: any,
  ) {
    const bytes = await registrationImage(
      registration,
      display,
      r.headers.cookie,
    );
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(Buffer.from(bytes ?? []));
  }
  @Get("me") async me(@Req() r: any) {
    const actor = await actorFor(r.headers.cookie);
    return transaction(actor, async (db) => {
      const user = (
        await db.query("SELECT id,email FROM users WHERE id=$1", [actor])
      ).rows[0];
      return {
        ...user,
        platform: (await db.query("SELECT is_platform_operator() allowed"))
          .rows[0].allowed,
      };
    });
  }
  @Get("clubs/:slug/public") async clubPublic(@Param("slug") slug: string) {
    const data = (
      await pool.query("SELECT public_club($1) data", [
        z
          .string()
          .regex(/^[a-z0-9-]{3,60}$/)
          .parse(slug),
      ])
    ).rows[0].data;
    if (!data) throw Error("NOT_FOUND");
    return data;
  }
  @Get("health") async health() {
    await pool.query("SELECT 1");
    return { status: "ok" };
  }
  @Get("auth/start") startLogin(@Query("next") next: string, @Res() res: any) {
    const flow = beginLogin(next);
    res.setHeader("Set-Cookie", flow.cookie);
    res.redirect(flow.url);
  }
  @Get("auth/callback") async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Req() r: any,
    @Res() res: any,
  ) {
    const flow = await finishLogin(
      z.string().min(1).max(4000).parse(code),
      z.string().min(1).max(200).parse(state),
      r.headers.cookie,
    );
    res.setHeader("Set-Cookie", [
      sessionCookie(flow.session),
      "msn_oauth=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0",
    ]);
    res.redirect(flow.next);
  }
  @Get("auth/config") config() {
    return {
      rehearsal: localLogin(),
      identityConfigured: !!process.env.OIDC_JWKS_URL,
      storageConfigured: !!process.env.S3_BUCKET,
      paymentsConfigured: !!process.env.RAZORPAY_KEY_ID,
    };
  }
  @Get("auth/rehearsal") async rehearsal() {
    const f = await fixture();
    return {
      auctionId: f.auction,
      roles: ["admin", "managerA", "managerB"],
      sample: true,
    };
  }
  @Post("auth/rehearsal") async login(
    @Body() body: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const f = await fixture();
    const role = z.enum(["admin", "managerA", "managerB"]).parse(body.role);
    res.setHeader("Set-Cookie", sessionCookie(f.sessions[role]));
    return { auctionId: f.auction, role, sample: true };
  }
  @Post("auth/token") async token(
    @Body() body: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const session = await exchangeIdentity(
      z.string().max(16000).parse(body.token),
    );
    res.setHeader("Set-Cookie", sessionCookie(session));
    return { ok: true };
  }
  @Post("auth/logout") async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const token = req.headers.cookie
      ?.split(";")
      .map((p: string) => p.trim())
      .find((p: string) => p.startsWith("msn_session="))
      ?.slice(12);
    if (token)
      await pool.query("SELECT delete_session($1)", [hashToken(token)]);
    res.setHeader(
      "Set-Cookie",
      "msn_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return { ok: true };
  }
  @Get("auctions") async list(@Req() r: any) {
    return preparation.list(await actorFor(r.headers.cookie));
  }
  @Post("clubs") async club(@Req() r: any, @Body() b: any) {
    return preparation.createClub(await actorFor(r.headers.cookie), b);
  }
  @Post("clubs/:id/auctions") async create(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return preparation.createAuction(
      await actorFor(r.headers.cookie),
      uuid(id),
      b,
    );
  }
  @Get("auctions/:id/snapshot") async snapshot(
    @Req() r: any,
    @Param("id") id: string,
  ) {
    return auction.snapshot(await actorFor(r.headers.cookie), uuid(id));
  }
  @Get("auctions/:id/public") async public(@Param("id") id: string) {
    return auction.publicSnapshot(uuid(id));
  }
  @Get("auctions/:id/events") async events(
    @Req() r: any,
    @Param("id") id: string,
    @Query("after") after: string,
  ) {
    return auction.events(
      await actorFor(r.headers.cookie),
      uuid(id),
      Number(after ?? 0),
    );
  }
  @Post("auctions/:id/commands") async command(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    const actor = await actorFor(r.headers.cookie);
    try {
      return await auction.command(actor, uuid(id), b);
    } catch (error: any) {
      if (error.message === "STALE_VERSION") {
        try {
          const snapshot = await auction.snapshot(actor, id);
          error.currentState = {
            sequence: snapshot.sequence,
            lot: snapshot.lots.find((l: any) => l.id === b?.lotId) ?? null,
          };
        } catch {
          /* Authorization may have been revoked. */
        }
      }
      throw error;
    }
  }
  @Get("commands/:id") async outcome(@Req() r: any, @Param("id") id: string) {
    const actor = await actorFor(r.headers.cookie);
    // Tenant context must be set before reading an outcome; lookup is a constrained function.
    const result2 = await pool.query("SELECT command_outcome($1,$2) outcome", [
      actor,
      uuid(id),
    ]);
    if (!result2.rows[0].outcome) throw Error("COMMAND_PENDING");
    return result2.rows[0].outcome;
  }
  @Post("auctions/:id/configure") async configAuction(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return preparation.configure(await actorFor(r.headers.cookie), uuid(id), b);
  }
  @Post("auctions/:id/teams") async team(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return preparation.team(await actorFor(r.headers.cookie), uuid(id), b);
  }
  @Post("auctions/:id/registrations") async register(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return preparation.register(await actorFor(r.headers.cookie), uuid(id), b);
  }
  @Get("auctions/:id/my-registration") async myRegistration(
    @Req() r: any,
    @Param("id") id: string,
  ) {
    return preparation.myRegistration(
      await actorFor(r.headers.cookie),
      uuid(id),
    );
  }
  @Post("auctions/:id/manager-applications") async apply(
    @Req() r: any,
    @Param("id") id: string,
  ) {
    return preparation.applyManager(await actorFor(r.headers.cookie), uuid(id));
  }
  @Post("auctions/:id/review") async review(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return preparation.review(await actorFor(r.headers.cookie), uuid(id), b);
  }
  @Post("auctions/:id/invites") async invite(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return preparation.invite(await actorFor(r.headers.cookie), uuid(id), b);
  }
  @Post("invites/accept") async accept(@Req() r: any, @Body() b: any) {
    return preparation.acceptInvite(await actorFor(r.headers.cookie), b.token);
  }
  @Get("auctions/:id/reconcile") async reconcile(
    @Req() r: any,
    @Param("id") id: string,
  ) {
    return auction.reconcile(await actorFor(r.headers.cookie), uuid(id));
  }
  @Get("auctions/:id/reports/:kind") async report(
    @Req() r: any,
    @Res() res: any,
    @Param("id") id: string,
    @Param("kind") kind: string,
  ) {
    const csv = await auction.report(
      await actorFor(r.headers.cookie),
      uuid(id),
      kind,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="msn-${kind}.csv"`,
    );
    res.send("\ufeff" + csv);
  }
}
@Module({ controllers: [API, PRDController] })
class App {}
export async function bootstrap() {
  if (!process.env.RUNTIME_DATABASE_URL || !process.env.WORKER_DATABASE_URL)
    throw Error("RUNTIME_DATABASE_URL and WORKER_DATABASE_URL required");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_REHEARSAL_LOGIN === "true"
  )
    throw Error("Rehearsal login forbidden in production");
  const databaseRole = (
    await pool.query(
      "SELECT current_user name,rolsuper,rolbypassrls,EXISTS(SELECT 1 FROM pg_class WHERE relname='auctions' AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) owns_authority FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (
    databaseRole.name !== "msn_runtime" ||
    databaseRole.rolsuper ||
    databaseRole.rolbypassrls ||
    databaseRole.owns_authority
  )
    throw Error("UNSAFE_RUNTIME_DATABASE_ROLE");
  const app = await NestFactory.create<
    import("@nestjs/platform-express").NestExpressApplication
  >(App, {
    rawBody: true,
    logger: ["error", "warn", "log", "debug", "verbose"],
  });
  app.useGlobalFilters(new Errors());
  app.useBodyParser("json", { limit: "8mb" });
  const rate = new Map<string, { count: number; until: number }>();
  app.use(async (req: any, res: any, next: any) => {
    const began = performance.now();
    res.once("finish", () =>
      observeRequest(
        res.statusCode,
        performance.now() - began,
        /^\/api\/auctions\/[^/]+\/commands$/.test(req.path) &&
          req.body?.type === "BID",
      ),
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "POST") {
      if (
        req.headers.origin !== process.env.WEB_ORIGIN &&
        !req.path.startsWith("/api/billing/webhooks/")
      )
        return res.status(403).json({ code: "INVALID_ORIGIN" });
      const commandPath = /^\/api\/auctions\/[^/]+\/commands$/.test(req.path);
      let authority = req.ip;
      if (commandPath) {
        try {
          authority = await actorFor(req.headers.cookie);
        } catch {
          return res.status(401).json({ code: "UNAUTHENTICATED" });
        }
      }
      // Venue Wi-Fi commonly puts every manager behind one IP. Commands are limited per actor and auction.
      const key = authority + ":" + (commandPath ? req.path : "other");
      if (rate.size > 10000)
        for (const [expiredKey, bucket] of rate)
          if (bucket.until < Date.now()) rate.delete(expiredKey);
      let r = rate.get(key);
      if (!r || r.until < Date.now()) {
        r = { count: 0, until: Date.now() + 10000 };
        rate.set(key, r);
      }
      if (++r.count > 100)
        return res.status(429).json({ code: "RATE_LIMITED" });
    }
    next();
  });
  const io = new Server(app.getHttpServer(), {
    path: "/socket.io",
    addTrailingSlash: false,
    pingInterval: 3000,
    pingTimeout: 3000,
    cors: { origin: process.env.WEB_ORIGIN, credentials: true },
    maxHttpBufferSize: 16384,
  });
  io.on("connection", (socket) => {
    socket.on("subscribe", async (input: any, ack: any) => {
      try {
        const id = uuid(input.auctionId);
        const actor = await actorFor(socket.handshake.headers.cookie);
        await auction.snapshot(actor, id);
        socket.data = { actor, auctionId: id };
        ack?.({ ok: true });
      } catch {
        ack?.({ code: "FORBIDDEN" });
        socket.disconnect(true);
      }
    });
  });
  // Separate, restricted delivery role. Publication can repeat; clients recover from durable cursors.
  const worker = new pg.Pool({
    connectionString: process.env.WORKER_DATABASE_URL,
    max: 1,
  });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const events = (
        await worker.query(
          "SELECT e.id,e.auction_id,e.sequence FROM outbox o JOIN auction_events e ON e.id=o.event_id WHERE o.delivered_at IS NULL AND o.retry_at<=now() ORDER BY e.occurred_at LIMIT 100",
        )
      ).rows;
      for (const e of events) {
        for (const socket of io.sockets.sockets.values())
          if (socket.data.auctionId === e.auction_id) {
            try {
              await auction.snapshot(
                await actorFor(socket.handshake.headers.cookie),
                e.auction_id,
              );
              socket.emit("committed", {
                auctionId: e.auction_id,
                sequence: e.sequence,
              });
            } catch {
              socket.disconnect(true);
            }
          }
        await worker.query(
          "UPDATE outbox SET delivered_at=now(),attempts=attempts+1 WHERE event_id=$1",
          [e.id],
        );
      }
    } catch (e: any) {
      console.error(
        JSON.stringify({
          level: "error",
          component: "outbox",
          message: e.message,
        }),
      );
    } finally {
      busy = false;
    }
  }, 250);
  timer.unref();
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.API_PORT ?? 4018),
    process.env.API_HOST ?? "127.0.0.1",
  );
  return {
    app,
    io,
    close: async () => {
      clearInterval(timer);
      io.close();
      await worker.end();
      await app.close();
      await pool.end();
    },
  };
}
if (
  process.argv[1]?.endsWith("main.ts") ||
  process.argv[1]?.endsWith("main.js")
)
  await bootstrap();
