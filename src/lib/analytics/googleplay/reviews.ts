import type { RatingsSummary, Review } from "../types";
import { gpFetchJson } from "./client";

// Google Play Developer API's `reviews.list` endpoint returns at most the last
// 7 days of reviews (and only ones with text — pure star-rating-only reviews
// are excluded). That's a real constraint — it means the rating distribution
// we compute is a *sampled* one, not the canonical 5-star breakdown shown on
// the Play Store listing. The UI already handles that via
// RatingsSummary.sampledFromReviews.

interface PlayReviewComment {
  userComment?: {
    text?: string;
    lastModified?: { seconds?: string };
    starRating?: number;
    reviewerLanguage?: string;
    device?: string;
    androidOsVersion?: number;
    appVersionCode?: number;
    appVersionName?: string;
    thumbsUpCount?: number;
    thumbsDownCount?: number;
  };
  developerComment?: {
    text?: string;
    lastModified?: { seconds?: string };
  };
}

interface PlayReview {
  reviewId: string;
  authorName?: string;
  comments?: PlayReviewComment[];
}

interface ReviewsListResponse {
  reviews?: PlayReview[];
  tokenPagination?: { nextPageToken?: string };
}

function secondsToIso(s: string | undefined): string {
  if (!s) return new Date().toISOString();
  const n = Number(s);
  if (!Number.isFinite(n)) return new Date().toISOString();
  return new Date(n * 1000).toISOString();
}

export async function listCustomerReviews(
  packageName: string,
  max = 200,
): Promise<Review[]> {
  const collected: Review[] = [];
  let pageToken: string | undefined;
  // Play caps per-page at 100; two pages is enough to get our 200-review sample.
  for (let i = 0; i < 5 && collected.length < max; i++) {
    const res: ReviewsListResponse = await gpFetchJson<ReviewsListResponse>(
      `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews`,
      {
        query: {
          maxResults: Math.min(100, max - collected.length),
          token: pageToken,
        },
      },
    );

    for (const r of res.reviews || []) {
      // The most recent user comment is always comments[0]; developer replies
      // can sit in later positions. Flatten to the user comment.
      const user = r.comments?.find((c) => c.userComment)?.userComment;
      const dev = r.comments?.find((c) => c.developerComment)?.developerComment;
      if (!user) continue;

      collected.push({
        id: r.reviewId,
        rating: typeof user.starRating === "number" ? user.starRating : 0,
        body: (user.text || "").trim(),
        author: r.authorName,
        createdAt: secondsToIso(user.lastModified?.seconds),
        territory: user.reviewerLanguage,
        responseBody: dev?.text,
        responseDate: dev?.lastModified?.seconds
          ? secondsToIso(dev.lastModified.seconds)
          : undefined,
      });
      if (collected.length >= max) break;
    }

    pageToken = res.tokenPagination?.nextPageToken;
    if (!pageToken) break;
  }

  return collected;
}

export function summarizeRatings(reviews: Review[]): RatingsSummary | undefined {
  if (!reviews.length) return undefined;
  const valid = reviews.filter((r) => r.rating >= 1 && r.rating <= 5);
  if (!valid.length) return undefined;

  const distribution: Record<"1" | "2" | "3" | "4" | "5", number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  let sum = 0;
  for (const r of valid) {
    const k = String(r.rating) as "1" | "2" | "3" | "4" | "5";
    distribution[k] += 1;
    sum += r.rating;
  }

  return {
    average: sum / valid.length,
    count: valid.length,
    distribution,
    // Flag the summary as sampled so the UI copy ("sampled from newest reviews")
    // correctly reflects that this isn't the canonical Play Store rating.
    sampledFromReviews: true,
  };
}
