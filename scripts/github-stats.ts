export type GitHubStats = {
  stars: number;
  commitsThisYear: number;
  totalPRs: number;
  totalIssues: number;
};

type GraphqlVariables = {
  login: string;
  from: string;
  to: string;
  after: string | null;
};

type GitHubStatsResponse = {
  user: {
    contributionsCollection: {
      totalCommitContributions: number;
    };
    pullRequests: {
      totalCount: number;
    };
    issues: {
      totalCount: number;
    };
    repositories: {
      nodes: Array<{
        isFork: boolean;
        stargazerCount: number;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  } | null;
};

const query = `
  query ($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
      }
      pullRequests(first: 1) {
        totalCount
      }
      issues(first: 1) {
        totalCount
      }
      repositories(first: 100, after: $after, ownerAffiliations: OWNER, privacy: PUBLIC) {
        nodes {
          isFork
          stargazerCount
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

async function graphql(
  token: string,
  variables: GraphqlVariables,
): Promise<GitHubStatsResponse> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json() as {
    data?: GitHubStatsResponse;
    errors?: unknown;
  };

  if (!response.ok || body.errors) {
    throw new Error(JSON.stringify(body.errors || body, null, 2));
  }

  if (!body.data) {
    throw new Error("GitHub GraphQL response did not include data.");
  }

  return body.data;
}

export async function fetchGitHubStats(
  login: string,
  token: string,
  date = new Date(),
): Promise<GitHubStats> {
  const year = date.getUTCFullYear();
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;

  let after: string | null = null;
  let stars = 0;
  let commitsThisYear = 0;
  let totalPRs = 0;
  let totalIssues = 0;

  do {
    const data = await graphql(token, { login, from, to, after });
    const user = data.user;

    if (!user) {
      throw new Error(`GitHub user not found: ${login}`);
    }

    commitsThisYear = user.contributionsCollection.totalCommitContributions;
    totalPRs = user.pullRequests.totalCount;
    totalIssues = user.issues.totalCount;

    for (const repo of user.repositories.nodes) {
      if (!repo.isFork) {
        stars += repo.stargazerCount;
      }
    }

    after = user.repositories.pageInfo.hasNextPage
      ? user.repositories.pageInfo.endCursor
      : null;
  } while (after);

  return { stars, commitsThisYear, totalPRs, totalIssues };
}
