#!/usr/bin/env node

/**
 * Connection Tester CLI
 * 
 * Tests connectivity to all external services from the command line.
 * 
 * Usage:
 *   node src/cli/test-connections.js [options]
 * 
 * Options:
 *   --all           Test all services (default)
 *   --coreapi       Test CoreAPI only
 *   --backblaze     Test Backblaze B2 only
 *   --dfw           Test DFW HTTP only
 *   --assemblyai    Test AssemblyAI only
 *   --deepgram      Test DeepGram only
 *   --dfw-file=PATH Test DFW with specific file path
 *   --json          Output as JSON (default is formatted text)
 *   --quiet         Only show failures
 */

import { initializeConfig } from '../config/appConfig.js';
import {
  testAllConnections,
  testCoreAPIConnection,
  testBackblazeConnection,
  testDFWConnection,
  testAssemblyAIConnection,
  testDeepGramConnection
} from '../utils/connectionTester.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  all: args.length === 0 || args.includes('--all'),
  coreapi: args.includes('--coreapi'),
  backblaze: args.includes('--backblaze'),
  dfw: args.includes('--dfw'),
  assemblyai: args.includes('--assemblyai'),
  deepgram: args.includes('--deepgram'),
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
  dfwFile: args.find(a => a.startsWith('--dfw-file='))?.split('=')[1]
};

// If any specific service is requested, disable 'all'
if (options.coreapi || options.backblaze || options.dfw || options.assemblyai || options.deepgram) {
  options.all = false;
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

/**
 * Format a single test result for console output
 */
function formatResult(result) {
  const statusIcon = result.success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
  const statusText = result.success ? `${colors.green}OK${colors.reset}` : `${colors.red}FAILED${colors.reset}`;
  const latency = result.latencyMS > 0 ? `${colors.dim}(${result.latencyMS}ms)${colors.reset}` : '';
  
  let output = `${statusIcon} ${colors.bright}${result.service.toUpperCase()}${colors.reset} ${statusText} ${latency}\n`;
  output += `  ${result.message}\n`;
  
  if (result.details && !options.quiet) {
    const detailLines = Object.entries(result.details)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => {
        const value = typeof v === 'object' ? JSON.stringify(v) : v;
        return `    ${colors.dim}${k}:${colors.reset} ${value}`;
      });
    if (detailLines.length > 0) {
      output += detailLines.join('\n') + '\n';
    }
  }
  
  return output;
}

/**
 * Format summary for console output
 */
function formatSummary(summary) {
  const successColor = summary.failed === 0 ? colors.green : colors.yellow;
  
  let output = `\n${colors.bright}═══ CONNECTION TEST SUMMARY ═══${colors.reset}\n`;
  output += `${successColor}${summary.successful}/${summary.totalServices}${colors.reset} services connected\n`;
  
  if (summary.notConfigured > 0) {
    output += `${colors.yellow}${summary.notConfigured}${colors.reset} services not configured\n`;
  }
  
  if (summary.failed > 0) {
    output += `${colors.red}${summary.failed}${colors.reset} services failed\n`;
  }
  
  output += `${colors.dim}Tested at: ${summary.timestamp}${colors.reset}\n`;
  
  return output;
}

async function main() {
  try {
    // Initialize configuration
    await initializeConfig();
    
    console.log(`${colors.bright}Testing external service connections...${colors.reset}\n`);
    
    let results = [];
    
    if (options.all) {
      const response = await testAllConnections({ dfwTestFile: options.dfwFile });
      results = response.results;
      
      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        // Print individual results
        for (const result of results) {
          if (!options.quiet || !result.success) {
            console.log(formatResult(result));
          }
        }
        // Print summary
        console.log(formatSummary(response.summary));
      }
    } else {
      // Test specific services
      const tests = [];
      
      if (options.coreapi) tests.push(testCoreAPIConnection());
      if (options.backblaze) tests.push(testBackblazeConnection());
      if (options.dfw) tests.push(testDFWConnection(options.dfwFile));
      if (options.assemblyai) tests.push(testAssemblyAIConnection());
      if (options.deepgram) tests.push(testDeepGramConnection());
      
      results = await Promise.all(tests);
      
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const result of results) {
          if (!options.quiet || !result.success) {
            console.log(formatResult(result));
          }
        }
      }
    }
    
    // Exit with error code if any failures
    const hasFailures = results.some(r => !r.success && !r.message.includes('Not configured'));
    process.exit(hasFailures ? 1 : 0);
    
  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

main();
