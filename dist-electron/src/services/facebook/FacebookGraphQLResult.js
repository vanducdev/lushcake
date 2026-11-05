"use strict";
/**
 * FacebookGraphQLResult.ts
 * Phase 7: Validate Facebook GraphQL/mutation responses.
 *
 * Facebook often returns HTTP 200 with error payloads:
 * - { error: {...} }
 * - { errors: [{message: "..."}] }
 * - { data: null } (mutation failed)
 * - Empty or malformed payload
 *
 * This helper detects all these cases and throws typed errors.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookOperationError = void 0;
exports.parseFacebookResponse = parseFacebookResponse;
exports.assertFacebookMutationSuccess = assertFacebookMutationSuccess;
const Logger_1 = __importDefault(require("../../utils/Logger"));
const FacebookMetrics_1 = require("./FacebookMetrics");
class FacebookOperationError extends Error {
    constructor(operation, code, message) {
        super(message);
        this.name = 'FacebookOperationError';
        this.operation = operation;
        this.code = code;
    }
}
exports.FacebookOperationError = FacebookOperationError;
/**
 * Strip Facebook's anti-JSON prefix (for(;;);)
 */
function stripAntiJSONPrefix(text) {
    return text.replace(/^for\s*\(;;\);/, '').trim();
}
/**
 * Parse a Facebook response body (handles anti-JSON prefix).
 */
function parseFacebookResponse(body) {
    const cleaned = stripAntiJSONPrefix(body);
    if (!cleaned)
        return null;
    try {
        return JSON.parse(cleaned);
    }
    catch {
        return null;
    }
}
/**
 * Assert that a Facebook mutation was successful.
 * Throws FacebookOperationError if the response indicates failure.
 *
 * @param operation  Name of the operation (for error messages)
 * @param payload    Parsed response payload
 * @param expected   Optional validator: return true if payload looks like success
 */
function assertFacebookMutationSuccess(operation, payload, expected) {
    if (payload === null || payload === undefined) {
        throw new FacebookOperationError(operation, 'empty_response', `${operation}: empty response`);
    }
    // Check for error/error subfield
    if (payload.error) {
        const errMsg = payload.error.message || payload.error.description || JSON.stringify(payload.error).slice(0, 200);
        (0, FacebookMetrics_1.metricInc)('fb_graphql_semantic_failure', undefined, { operation, code: 'api_error' });
        Logger_1.default.warn(`[FBGraphQL] ${operation} error: ${errMsg}`);
        throw new FacebookOperationError(operation, 'api_error', `${operation}: ${errMsg}`);
    }
    // Check for errors array (GraphQL standard)
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        const errMsg = payload.errors[0].message || JSON.stringify(payload.errors[0]).slice(0, 200);
        (0, FacebookMetrics_1.metricInc)('fb_graphql_semantic_failure', undefined, { operation, code: 'graphql_errors' });
        Logger_1.default.warn(`[FBGraphQL] ${operation} errors: ${errMsg}`);
        throw new FacebookOperationError(operation, 'graphql_errors', `${operation}: ${errMsg}`);
    }
    // Check for data: null (mutation failed silently)
    if (payload.data === null && !expected) {
        (0, FacebookMetrics_1.metricInc)('fb_graphql_semantic_failure', undefined, { operation, code: 'null_data' });
        throw new FacebookOperationError(operation, 'null_data', `${operation}: data is null`);
    }
    // Run custom validator if provided
    if (expected && !expected(payload)) {
        throw new FacebookOperationError(operation, 'validation_failed', `${operation}: response validation failed`);
    }
}
//# sourceMappingURL=FacebookGraphQLResult.js.map