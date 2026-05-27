#!/usr/bin/env fish

set -l root (realpath (dirname (status --current-filename))/..)
set -l json_path "$root/assets/about-my-github/about-my-github.json"
set -l login "ermengchao"
set -l endpoint "https://api.github.com/graphql"

if not set -q GITHUB_PAT
    echo "Missing GITHUB_PAT. Export a GitHub token before running this script." >&2
    exit 1
else if not string length -q -- "$GITHUB_PAT"
    echo "Missing GITHUB_PAT. Export a GitHub token before running this script." >&2
    exit 1
end

if not command -q curl
    echo "Missing curl." >&2
    exit 1
end

if not command -q jq
    echo "Missing jq." >&2
    exit 1
end

set -l year (date -u +%Y)
set -l from "$year-01-01T00:00:00Z"
set -l to "$year-12-31T23:59:59Z"
set -l query '
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
'

function request_github \
    --argument-names after \
    --inherit-variable endpoint \
    --inherit-variable query \
    --inherit-variable login \
    --inherit-variable from \
    --inherit-variable to
    jq -n \
        --arg query "$query" \
        --arg login "$login" \
        --arg from "$from" \
        --arg to "$to" \
        --arg after "$after" \
        '{
          query: $query,
          variables: {
            login: $login,
            from: $from,
            to: $to,
            after: (if $after == "" then null else $after end)
          }
        }' |
    curl --fail-with-body --silent --show-error \
        --request POST "$endpoint" \
        --header "Authorization: Bearer $GITHUB_PAT" \
        --header "Content-Type: application/json" \
        --data-binary @-
end

set -l after ""
set -l stars 0
set -l commits_this_year 0
set -l total_prs 0
set -l total_issues 0

while true
    set -l body (request_github "$after")
    or exit 1

    set -l errors (echo "$body" | jq -c '.errors // empty')
    if test -n "$errors"
        echo "$errors" | jq . >&2
        exit 1
    end

    set -l user_exists (echo "$body" | jq -r '.data.user != null')
    if test "$user_exists" != true
        echo "GitHub user not found: $login" >&2
        exit 1
    end

    set commits_this_year (echo "$body" | jq -r '.data.user.contributionsCollection.totalCommitContributions')
    set total_prs (echo "$body" | jq -r '.data.user.pullRequests.totalCount')
    set total_issues (echo "$body" | jq -r '.data.user.issues.totalCount')

    set -l page_stars (echo "$body" | jq '[.data.user.repositories.nodes[] | select(.isFork | not) | .stargazerCount] | add // 0')
    set stars (math "$stars + $page_stars")

    set -l has_next_page (echo "$body" | jq -r '.data.user.repositories.pageInfo.hasNextPage')
    if test "$has_next_page" != true
        break
    end

    set after (echo "$body" | jq -r '.data.user.repositories.pageInfo.endCursor')
end

set -l tmp_path (mktemp)
or exit 1

jq \
    --argjson stars "$stars" \
    --argjson commits "$commits_this_year" \
    --argjson prs "$total_prs" \
    --argjson issues "$total_issues" \
    '."about-my-github" |= with_entries(
      if (.key | contains("total-stars-earned")) then .value = $stars
      elif (.key | contains("total-commits(this year)")) then .value = $commits
      elif (.key | contains("total-PRs")) then .value = $prs
      elif (.key | contains("total-issues")) then .value = $issues
      else .
      end
    )' "$json_path" > "$tmp_path"
or begin
    rm -f "$tmp_path"
    exit 1
end

mv "$tmp_path" "$json_path"

echo "Updated $json_path"
echo "Stats: stars=$stars, commits=$commits_this_year, prs=$total_prs, issues=$total_issues"
