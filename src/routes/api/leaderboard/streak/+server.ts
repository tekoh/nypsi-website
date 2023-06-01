import prisma from "$lib/server/database";
import rateLimiter from "$lib/server/ratelimit.js";
import redis from "$lib/server/redis.js";
import { json } from "@sveltejs/kit";

export async function GET({ getClientAddress, setHeaders }) {
  const rateLimitAttempt = await rateLimiter.limit(getClientAddress());

  if (!rateLimitAttempt.success) {
    const timeRemaining = Math.floor((rateLimitAttempt.reset - new Date().getTime()) / 1000);
    return new Response(JSON.stringify({ error: `Too many requests. Please try again in ${timeRemaining} seconds.` }), {
      status: 429
    });
  }

  setHeaders({
    "cache-control": "max-age=120"
  });

  if (await redis.exists("top-streaks")) {
    return json(await redis.get("top-streaks"));
  }

  const query = await prisma.economy
    .findMany({
      where: {
        AND: [{ money: { gt: 0 } }, { user: { blacklisted: false } }]
      },
      select: {
        dailyStreak: true,
        banned: true,
        user: {
          select: {
            Preferences: {
              select: {
                leaderboards: true
              }
            },
            lastKnownTag: true
          }
        }
      },
      orderBy: {
        dailyStreak: "desc"
      },
      take: 100
    })
    .then((r) => {
      let count = 0;
      r.forEach((user) => {
        if (user.banned && user.banned.getTime() > Date.now()) r.splice(r.indexOf(user), 1);
      });
      return r.map((x) => {
        count++;
        const user = x.user.lastKnownTag.split("#")[0];
        return {
          value: `${x.dailyStreak.toLocaleString()}`,
          username: x.user.Preferences?.leaderboards ? user : "[hidden]",
          position: count
        };
      });
    });

  await redis.set("top-streaks", JSON.stringify(query), { ex: 300 });

  return json(query);
}
