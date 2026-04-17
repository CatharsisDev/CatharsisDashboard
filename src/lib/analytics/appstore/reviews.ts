import { ascFetchAll } from "./client";
import type { Review, RatingsSummary } from "../types";

interface AscReviewAttributes {
  rating: number;
  title?: string;
  body?: string;
  reviewerNickname?: string;
  createdDate: string;
  territory?: string;
}

interface AscReview {
  type: "customerReviews";
  id: string;
  attributes?: AscReviewAttributes;
  relationships?: {
    response?: { data?: { id: string; type: string } | null };
  };
}

export async function listCustomerReviews(appId: string, maxReviews = 200): Promise<Review[]> {
  const raw = await ascFetchAll<AscReview>(
    `/v1/apps/${encodeURIComponent(appId)}/customerReviews`,
    {
      query: {
        limit: 200,
        sort: "-createdDate",
        "fields[customerReviews]":
          "rating,title,body,reviewerNickname,createdDate,territory",
      },
      maxPages: Math.max(1, Math.ceil(maxReviews / 200)),
    },
  );

  return raw.slice(0, maxReviews).map((r) => ({
    id: r.id,
    rating: Number(r.attributes?.rating || 0),
    title: r.attributes?.title,
    body: r.attributes?.body || "",
    author: r.attributes?.reviewerNickname,
    createdAt: r.attributes?.createdDate || new Date().toISOString(),
    territory: r.attributes?.territory,
  }));
}

export function summarizeRatings(reviews: Review[]): RatingsSummary | undefined {
  if (!reviews.length) return undefined;
  const distribution: Record<"1" | "2" | "3" | "4" | "5", number> = {
    "1": 0, "2": 0, "3": 0, "4": 0, "5": 0,
  };
  let sum = 0;
  for (const r of reviews) {
    const rounded = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    distribution[String(rounded) as "1" | "2" | "3" | "4" | "5"] += 1;
    sum += r.rating;
  }
  return {
    average: sum / reviews.length,
    count: reviews.length,
    distribution,
    sampledFromReviews: true,
  };
}
