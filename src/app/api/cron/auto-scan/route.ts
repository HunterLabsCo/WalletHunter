import { NextRequest } from "next/server";
import { runScanPipeline } from "@/lib/scanner/pipeline";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runScanPipeline(null, "auto");

    if (result.error) {
      return Response.json(
        {
          error: result.error,
          scanId: result.scanId,
          duration: result.duration,
        },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      scanId: result.scanId,
      walletsFound: result.walletsFound,
      trendingCoins: result.trendingCoins.length,
      duration: result.duration,
    });
  } catch (err) {
    console.error("[auto-scan cron] Pipeline error:", err);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
