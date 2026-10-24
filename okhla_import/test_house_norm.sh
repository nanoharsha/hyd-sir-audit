#!/bin/sh
# Runs the house-identity vectors through the TypeScript implementation (copied to .mts so Node treats it as an ES module).
cd "$(dirname "$0")/.." && cp src/okhla_house.ts okhla_import/.okhla_house_under_test.mts && node --experimental-strip-types okhla_import/test_house_norm.mjs 2>&1 | grep -v -i "warning\|trace-warnings"; rc=$?; rm -f okhla_import/.okhla_house_under_test.mts; exit $rc
