// Shared types for the homepage "Top posts" feature. Lives in its own file
// so the page.tsx server component and the top-posts-tabs.tsx client
// component can both import from here without one pulling the other across
// the server/client boundary.

import type { PlatformPostAnalytics } from "@/lib/uploadpost";

export type TopPost = {
  requestId: string;
  title: string;
  mediaType: string;
  uploadedAt?: string;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  totalEngagement: number;
  platforms: [string, PlatformPostAnalytics][];
};

export type TopPostSortKey = "views" | "likes" | "comments" | "engagement";

export type TopPostsRankings = Record<TopPostSortKey, TopPost[]>;
