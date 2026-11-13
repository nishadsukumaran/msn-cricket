import pg from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
export const rules = {
  purse: 10000,
  minSquad: 2,
  maxSquad: 11,
  minimumBase: 100,
  defaultBase: 300,
  increment: 100,
  reserveEnabled: true,
};
export async function seed(options: { rehearsal?: boolean } = {}) {
  if (process.env.NODE_ENV === "production") throw Error("REHEARSAL_ONLY");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const f: any = {
    id: randomUUID(),
    club: randomUUID(),
    admin: randomUUID(),
    managerA: randomUUID(),
    managerB: randomUUID(),
    outsider: randomUUID(),
    auction: randomUUID(),
    secondAuction: randomUUID(),
    players: [],
    sessions: {},
  };
  try {
    await db.query("BEGIN");
    for (const role of ["admin", "managerA", "managerB", "outsider"]) {
      await db.query(
        "INSERT INTO users(id,identity_subject,email) VALUES($1,$2,$3)",
        [f[role], "fictional:" + f[role], `${role}@example.invalid`],
      );
      const token = randomBytes(32).toString("hex");
      f.sessions[role] = token;
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
        [createHash("sha256").update(token).digest("hex"), f[role]],
      );
    }
    await db.query("INSERT INTO clubs(id,slug,name) VALUES($1,$2,$3)", [
      f.club,
      "malabar-" + f.id,
      "Malabar Cricket Club · Rehearsal",
    ]);
    for (const role of ["admin", "managerA", "managerB"])
      await db.query("INSERT INTO memberships VALUES($1,$2,$3)", [
        f.club,
        f[role],
        role === "admin" ? "OWNER" : "MEMBER",
      ]);
    for (const auction of [f.auction, f.secondAuction]) {
      await db.query(
        "INSERT INTO auctions(id,club_id,name,status,rules,public_visible,rehearsal,venue,scheduled_at,selection_mode) VALUES($1,$2,$3,'REGISTRATION_OPEN',$4,true,$5,'Kozhikode · Sample venue',now()+interval '1 day','BOTH')",
        [
          auction,
          f.club,
          "Malabar Premier Auction · Sample",
          rules,
          options.rehearsal ?? false,
        ],
      );
      for (const [index, role] of ["managerA", "managerB"].entries()) {
        const team = randomUUID();
        await db.query(
          "INSERT INTO teams(id,club_id,auction_id,code,name,initial_purse,remaining_purse,color) VALUES($1,$2,$3,$4,$5,10000,10000,$6)",
          [
            team,
            f.club,
            auction,
            index ? "WAV" : "STR",
            index ? "Calicut Waves" : "Malabar Strikers",
            index ? "#08704E" : "#0759D3",
          ],
        );
        await db.query(
          "INSERT INTO team_operators(club_id,auction_id,team_id,user_id) VALUES($1,$2,$3,$4)",
          [f.club, auction, team, f[role]],
        );
        await db.query(
          "INSERT INTO manager_applications(club_id,auction_id,user_id,team_id,status,reviewed_by) VALUES($1,$2,$3,$4,'APPROVED',$5)",
          [f.club, auction, f[role], team, f.admin],
        );
      }
      for (const [i, name] of [
        "Arjun Menon",
        "Nithin Raj",
        "Vishnu Nair",
        "Rahul Das",
        "Sreejith K",
        "Adil Rahman",
      ].entries()) {
        const player = randomUUID(),
          reg = randomUUID();
        await db.query(
          "INSERT INTO player_profiles(id,user_id,name,phone,location,role,batting_style,bowling_style) VALUES($1,$2,$3,'555-0100','Kozhikode',$4,'Right hand','Right arm medium')",
          [
            player,
            f.admin,
            name,
            ["BATTER", "BOWLER", "ALL_ROUNDER", "KEEPER"][i % 4],
          ],
        );
        await db.query(
          "INSERT INTO registrations(id,club_id,auction_id,player_id,profile_snapshot,effective_base,status,display_consent_at,reviewed_by) VALUES($1,$2,$3,$4,$5,300,'APPROVED',now(),$6)",
          [
            reg,
            f.club,
            auction,
            player,
            {
              name,
              role: ["BATTER", "BOWLER", "ALL_ROUNDER", "KEEPER"][i % 4],
              location: "Kozhikode",
              battingStyle: "Right hand",
              bowlingStyle: "Right arm medium",
            },
            f.admin,
          ],
        );
        if (auction === f.auction) f.players.push(reg);
      }
    }
    await db.query(
      "INSERT INTO credit_grants(club_id,units,source,granted_by,reason) VALUES($1,1,'MANUAL',$2,'Fictional local acceptance rehearsal')",
      [f.club, f.admin],
    );
    await db.query("INSERT INTO rehearsal_fixtures(id,fixture) VALUES($1,$2)", [
      f.id,
      f,
    ]);
    await db.query("COMMIT");
    return f;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}
