const std = @import("std");
const json = std.json;
const httpz = @import("httpz");

const InitRequest = struct {
    secret: u64,
    threshold: u8,
    total_members: u8,
};

const SharesRequest = struct {
    threshold: u8,
};

const ReconstructRequest = struct {
    shares: []const []const u8,
    threshold: u8,
};

const ErrorResponse = struct {
    success: bool,
    message: []const u8,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    const allocator = gpa.allocator();
    defer _ = gpa.deinit();

    var server = try httpz.Server(void).init(allocator, .{.port = 5882}, {});
    defer {
        server.stop();
        server.deinit();
    }

    // Configure CORS
    var router = server.router(.{});
    // router.setCorsAllowOrigin("*");
    // router.setCorsAllowHeaders("Content-Type");
    // router.setCorsAllowMethods("POST, OPTIONS");

    // Register routes
    router.post("/api/init", handleInit, .{});
    router.post("/api/shares", handleShares, .{});
    router.post("/api/reconstruct", handleReconstruct, .{});

    try server.listen();
}

fn handleError(err: httpz.Server().Error) void {
    std.log.err("Server error: {}", .{err});
}

fn handleInit(req: *httpz.Request, res: *httpz.Response) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();

    // Read and parse request body
    if (req.body()) |body| {
        const stdout = std.io.getStdOut().writer();
        try stdout.print("Body: {s}\n", .{body});
        if (try req.json(InitRequest)) |parsed| {
            if (parsed.threshold > parsed.total_shares) {
                return sendError(res, "Threshold cannot be greater than total shares");
            }

            if (parsed.threshold < 2) {
                return sendError(res, "Threshold must be at least 2");
            }

            try sendJson(res, .{
                .success = true,
                .message = "Initialized successfully",
            });
        }
    }
}

fn handleShares(req: *httpz.Request, res: *httpz.Response) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    if (req.body()) |body| {
        var parsed = try std.json.parseFromSlice(SharesRequest, allocator, body, .{});
        defer parsed.deinit();

        if (parsed.value.threshold > parsed.value.total_shares) {
            return sendError(res, "Threshold cannot be greater than total shares");
        }

        try sendJson(res, .{
            .success = true,
            .shares = "Generated shares will go here",
        });
    }
}

fn handleReconstruct(req: *httpz.Request, res: *httpz.Response) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    if (req.body()) |body| {
        var parsed = try std.json.parseFromSlice(ReconstructRequest, allocator, body, .{});
        defer parsed.deinit();

        if (parsed.value.shares.len < parsed.value.threshold) {
            return sendError(res, "Insufficient shares provided");
        }

        try sendJson(res, .{
            .success = true,
            .secret = 0, // Replace with actual reconstructed secret
        });
    }
}

fn sendError(res: *httpz.Response, message: []const u8) !void {
    try sendJson(res, .{
        .success = false,
        .message = message,
    });
}

fn sendJson(res: *httpz.Response, value: anytype) !void {
    res.status = 200;
    //try res.headers.put("Content-Type", "application/json");
    try res.json(value, .{});
}
