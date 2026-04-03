sh clean.sh && bun i && grep -q '"gen"' package.json 2>/dev/null && bun run gen; bun run fix && bun run check
