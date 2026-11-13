import { requestMetrics } from "./metrics.ts";
import { PlatformService, requirePlatform } from "./platform.ts";
import { CommerceService } from "./commerce.ts";
import { runMaintenance } from "./jobs.ts";
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { z } from "zod";
import { createHash } from "node:crypto";
import { AdministrationService } from "./admin.ts";
import { ProfilesService } from "./profiles.ts";
import { actorFor } from "./auth.ts";
import { transaction } from "../../../packages/database/src/db.ts";
import { readPhoto } from "./storage.ts";
const administration = new AdministrationService(),
  profiles = new ProfilesService();
const id = (v: string) => z.string().uuid().parse(v);
@Controller("api")
export class PRDController {
  @Get("platform/overview") async platform(@Req() r: any) {
    return {
      ...(await new PlatformService().console(
        await actorFor(r.headers.cookie),
      )),
      apiMetrics: requestMetrics(),
    };
  }
  @Get("platform/requests") async requests(@Req() r: any) {
    return new PlatformService().requests(await actorFor(r.headers.cookie));
  }
  @Post("platform/products") async product(@Req() r: any, @Body() b: any) {
    return new PlatformService().product(await actorFor(r.headers.cookie), b);
  }
  @Post("platform/credit-revoke") async creditRevoke(
    @Req() r: any,
    @Body() b: any,
  ) {
    return new PlatformService().revokeCredit(
      await actorFor(r.headers.cookie),
      b,
    );
  }
  @Post("platform/credit-review") async creditReview(
    @Req() r: any,
    @Body() b: any,
  ) {
    return new PlatformService().reviewCredit(
      await actorFor(r.headers.cookie),
      b,
    );
  }
  @Post("platform/support") async support(@Req() r: any, @Body() b: any) {
    return new PlatformService().support(await actorFor(r.headers.cookie), b);
  }
  @Post("platform/suspend") async suspend(@Req() r: any, @Body() b: any) {
    return new PlatformService().suspend(await actorFor(r.headers.cookie), b);
  }
  @Post("platform/alerts/:id/resolve") async alert(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return new PlatformService().resolveAlert(
      await actorFor(r.headers.cookie),
      id(aid),
    );
  }
  @Post("platform/reconcile") async reconcile(@Req() r: any) {
    return new CommerceService().reconcile(await actorFor(r.headers.cookie));
  }
  @Post("platform/maintenance") async maintenance(@Req() r: any) {
    const actor = await actorFor(r.headers.cookie);
    await transaction(actor, requirePlatform);
    return runMaintenance({
      orphanImageDays: Number(process.env.ORPHAN_IMAGE_DAYS),
      sessionRetentionDays: Number(process.env.SESSION_RETENTION_DAYS),
    });
  }
  @Get("auctions/:id/metrics") async metrics(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return new PlatformService().metrics(
      await actorFor(r.headers.cookie),
      id(aid),
    );
  }
  @Get("auctions/:id/billing") async billing(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return new PlatformService().billing(
      await actorFor(r.headers.cookie),
      id(aid),
    );
  }
  @Post("auctions/:id/credit-request") async creditRequest(
    @Req() r: any,
    @Param("id") aid: string,
    @Body() b: any,
  ) {
    return new PlatformService().requestCredit(
      await actorFor(r.headers.cookie),
      id(aid),
      b,
    );
  }
  @Post("profile/erase") async erase(@Req() r: any, @Body() b: any) {
    z.object({ confirm: z.literal(true) }).parse(b);
    return profiles.erase(await actorFor(r.headers.cookie));
  }

  @Get("auctions/:id/asset") async asset(
    @Req() r: any,
    @Param("id") aid: string,
    @Query("team") team: string,
    @Query("display") display: string,
    @Res() res: any,
  ) {
    let actor = "";
    try {
      actor = await actorFor(r.headers.cookie);
    } catch {
      /* public read */
    }
    const key = await transaction(
      actor,
      async (db) =>
        (
          await db.query("SELECT authorized_asset($1,$2,$3) key", [
            id(aid),
            team ? id(team) : null,
            display && /^[a-f0-9]{64}$/.test(display)
              ? createHash("sha256").update(display).digest("hex")
              : "",
          ])
        ).rows[0].key,
    );
    if (!key) throw Error("NOT_FOUND");
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(Buffer.from((await readPhoto(key)) ?? []));
  }
  @Post("auctions/:id/rehearse") async rehearse(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return administration.rehearse(await actorFor(r.headers.cookie), id(aid));
  }
  @Post("auctions/:id/ownership") async ownership(
    @Req() r: any,
    @Param("id") aid: string,
    @Body() b: any,
  ) {
    return administration.transfer(
      await actorFor(r.headers.cookie),
      id(aid),
      b,
    );
  }
  @Get("profile") async profile(@Req() r: any) {
    return profiles.get(await actorFor(r.headers.cookie));
  }
  @Post("profile") async save(@Req() r: any, @Body() b: any) {
    return profiles.save(await actorFor(r.headers.cookie), b);
  }
  @Post("auctions/:id/withdraw") async withdraw(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return profiles.withdraw(await actorFor(r.headers.cookie), id(aid));
  }
  @Get("auctions/:id/staff") async directory(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return administration.directory(await actorFor(r.headers.cookie), id(aid));
  }
  @Post("auctions/:id/staff") async staff(
    @Req() r: any,
    @Param("id") aid: string,
    @Body() b: any,
  ) {
    return administration.staff(await actorFor(r.headers.cookie), id(aid), b);
  }
  @Post("auctions/:id/handover") async handover(
    @Req() r: any,
    @Param("id") aid: string,
    @Body() b: any,
  ) {
    return administration.handover(
      await actorFor(r.headers.cookie),
      id(aid),
      b,
    );
  }
  @Post("auctions/:id/display") async display(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return administration.display(await actorFor(r.headers.cookie), id(aid));
  }
  @Post("auctions/:id/display/revoke") async revoke(
    @Req() r: any,
    @Param("id") aid: string,
  ) {
    return administration.revokeDisplay(
      await actorFor(r.headers.cookie),
      id(aid),
    );
  }
  @Get("display/:token") async projection(
    @Param("token") token: string,
    @Res() res: any,
  ) {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json(await administration.projection(token));
  }
  @Post("auctions/:id/branding") async branding(
    @Req() r: any,
    @Param("id") aid: string,
    @Body() b: any,
  ) {
    return administration.branding(
      await actorFor(r.headers.cookie),
      id(aid),
      b,
    );
  }
  @Get("auctions/:id/review/:registration") async review(
    @Req() r: any,
    @Param("id") aid: string,
    @Param("registration") registration: string,
  ) {
    return profiles.review(
      await actorFor(r.headers.cookie),
      id(aid),
      id(registration),
    );
  }
  @Get("profile/photo") async ownPhoto(@Req() r: any, @Res() res: any) {
    const profile = await profiles.get(await actorFor(r.headers.cookie));
    if (!profile?.photoKey) throw Error("NOT_FOUND");
    res.setHeader("Content-Type", "image/webp");
    res.send(Buffer.from((await readPhoto(profile.photoKey)) ?? []));
  }
}
export async function registrationImage(
  registration: string,
  display: string | undefined,
  cookie: string | undefined,
) {
  let actor = "";
  try {
    actor = await actorFor(cookie);
  } catch {
    /* Public/display access can be authorized without a user. */
  }
  return transaction(actor, async (db) => {
    const hash =
      display && /^[a-f0-9]{64}$/.test(display)
        ? createHash("sha256").update(display).digest("hex")
        : "";
    const key = (
      await db.query("SELECT accessible_photo($1,$2) key", [
        id(registration),
        hash,
      ])
    ).rows[0].key;
    if (!key) throw Error("NOT_FOUND");
    return readPhoto(key);
  });
}
