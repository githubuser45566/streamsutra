#!/usr/bin/env node
/**
 * run_e2e_tests.js
 * Comprehensive 4-Tier E2E Test Suite Orchestrator & Reporter
 * Runs Tiers 1-4, tracks per-tier metrics, and outputs formatted summary.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const TESTS_DIR = __dirname;
const TIERS = [
    {
        id: 1,
        name: 'Tier 1: Feature Coverage (18 features x 5 tests)',
        file: path.join(TESTS_DIR, 'tier1_feature_coverage.test.js'),
        expectedMin: 90
    },
    {
        id: 2,
        name: 'Tier 2: Boundary & Corner Cases (18 features x 5)',
        file: path.join(TESTS_DIR, 'tier2_boundary_cases.test.js'),
        expectedMin: 90
    },
    {
        id: 3,
        name: 'Tier 3: Cross-Feature Combinations (18 pairs)',
        file: path.join(TESTS_DIR, 'tier3_cross_feature.test.js'),
        expectedMin: 18
    },
    {
        id: 4,
        name: 'Tier 4: Real-World Application Scenarios (9 E2E)',
        file: path.join(TESTS_DIR, 'tier4_real_world_scenarios.test.js'),
        expectedMin: 9
    }
];

function runTier(tier) {
    process.stdout.write(`\n🚀 Executing ${tier.name}...\n`);
    const t0 = Date.now();

    const res = spawnSync(process.execPath, ['--test', tier.file], {
        encoding: 'utf8',
        timeout: 60000
    });

    const duration = ((Date.now() - t0) / 1000).toFixed(2);
    const output = (res.stdout || '') + (res.stderr || '');

    // Parse node:test output
    const passMatch = output.match(/ℹ pass (\d+)/);
    const failMatch = output.match(/ℹ fail (\d+)/);
    const totalMatch = output.match(/ℹ tests (\d+)/);

    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    const success = res.status === 0 && failed === 0 && passed >= tier.expectedMin;

    if (success) {
        process.stdout.write(`   ✔ PASSED: ${passed}/${total} tests passed (${duration}s)\n`);
    } else {
        process.stdout.write(`   ✖ FAILED: ${passed} passed, ${failed} failed (${duration}s)\n`);
        if (res.status !== 0) {
            console.error(output);
        }
    }

    return {
        ...tier,
        total,
        passed,
        failed,
        duration,
        exitCode: res.status,
        success
    };
}

function main() {
    console.log('======================================================================');
    console.log('   LIVE TV & CINEMA HUB — 4-TIER E2E TEST SUITE RUNNER');
    console.log('======================================================================');

    const args = process.argv.slice(2);
    let selectedTiers = TIERS;

    if (args.includes('--tier') || args.includes('-t')) {
        const tierIdx = args.indexOf('--tier') !== -1 ? args.indexOf('--tier') + 1 : args.indexOf('-t') + 1;
        const requestedTier = parseInt(args[tierIdx], 10);
        selectedTiers = TIERS.filter(t => t.id === requestedTier);
        if (selectedTiers.length === 0) {
            console.error(`Invalid tier specified: ${args[tierIdx]}. Choose 1, 2, 3, or 4.`);
            process.exit(1);
        }
    }

    const results = selectedTiers.map(runTier);

    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    console.log('\n======================================================================');
    console.log('   E2E EXECUTION SUMMARY MATRIX');
    console.log('======================================================================');

    results.forEach(r => {
        totalTests += r.total;
        totalPassed += r.passed;
        totalFailed += r.failed;
        const statusStr = r.success ? 'PASSED' : 'FAILED';
        const paddedName = r.name.padEnd(52, ' ');
        console.log(`   ${paddedName} : ${String(r.passed).padStart(3)} / ${String(r.total).padStart(3)} ${statusStr}`);
    });

    console.log('----------------------------------------------------------------------');
    console.log(`   TOTAL TESTS EXECUTED : ${totalTests}`);
    console.log(`   TOTAL TESTS PASSED   : ${totalPassed}`);
    console.log(`   TOTAL TESTS FAILED   : ${totalFailed}`);

    const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0';
    console.log(`   OVERALL SUCCESS RATE : ${passRate}%`);
    console.log('======================================================================');

    const allPassed = results.every(r => r.success);
    if (allPassed) {
        console.log('🎉 100% E2E TRACK COMPLETE: All features, boundary cases, combinations, and journeys PASSED!\n');
        process.exit(0);
    } else {
        console.error('❌ E2E TEST FAILURES DETECTED: Review above logs for details.\n');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
