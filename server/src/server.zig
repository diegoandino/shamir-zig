const std = @import("std");
const Managed = std.math.big.int.Managed;
const json = std.json;
const httpz = @import("httpz");
const scheme = @import("scheme");

const InitRequest = struct {
    secret: []const u8,
    threshold: u8,
    total_shares: u8,
};

const SharesRequest = struct {
    count: u8,
};

const u64Share = struct {
    x: usize,
    y: []const u8,
};

const ReconstructRequest = struct {
    shares: []const u64Share,
};

const ErrorResponse = struct {
    success: bool,
    message: []const u8,
};

const State = struct {
    SSSS: scheme.ShamirsSecretSharingScheme,
    shares: []scheme.Share,
    share_index: u8,
};

var state: ?State = null;

// shared allocator
var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
const allocator = arena.allocator();

pub fn main() !void {
    var server = try httpz.Server(void).init(allocator, .{ .port = 5882 }, {});
    defer {
        server.stop();
        server.deinit();
    }

    var router = server.router(.{});

    // Register routes
    router.post("/api/init", handleInit, .{});
    router.post("/api/shares", handleShares, .{});
    router.post("/api/reconstruct", handleReconstruct, .{});

    const stdout = std.io.getStdOut().writer();
    try stdout.print("Running server\n", .{});

    try server.listen();

    arena.deinit();
}

fn handleError(err: httpz.Server().Error) void {
    std.log.err("Server error: {}", .{err});
}

fn handleInit(req: *httpz.Request, res: *httpz.Response) !void {
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

            var secret = try Managed.init(allocator);
            defer secret.deinit();
            
            try secret.setString(10, parsed.secret);

            var SSSS = scheme.ShamirsSecretSharingScheme.init(
                allocator,
                parsed.threshold,
                parsed.total_shares,
                try scheme.choosePrime(allocator, secret, 5)
            );

            try stdout.print("Parsed secret: {any}\n", .{secret});
            state = State{
                .SSSS = SSSS,
                .shares = try SSSS.compute_shares(secret),
                .share_index = 0
            };

            try sendJson(res, .{
                .message = "Initialized successfully",
            });
        }
    }
}

fn handleShares(req: *httpz.Request, res: *httpz.Response) !void {
    if (state == null) {
        return sendError(res, "Not yet initialized");
    }

    if (req.body()) |body| {
        const stdout = std.io.getStdOut().writer();
        try stdout.print("Shares request body: {s}\n", .{body});

        if (try req.json(SharesRequest)) |parsed| {
            if (state.?.share_index + parsed.count > state.?.shares.len) {
                return sendError(res, "Not enough shares to give");
            }

            const shares = try allocator.alloc(u64Share, parsed.count);
            defer allocator.free(shares);
            
            var i: u8 = 0;
            while (i < parsed.count) : (i += 1) {
                //const new_y = try state.?.shares[state.?.share_index + i].y.to(u64);
                const new_y = try state.?.shares[state.?.share_index + i].y.toString(allocator, 10, .lower);

                shares[i] = u64Share{
                    .x = state.?.shares[state.?.share_index + i].x,
                    .y = new_y,
                };
            }
            state.?.share_index = state.?.share_index + i;

            try sendJson(res, .{
                .shares = shares,
            });
        }
    }
}

fn handleReconstruct(req: *httpz.Request, res: *httpz.Response) !void {
    if (state == null) {
        return sendError(res, "Not yet initialized");
    }

    if (req.body()) |body| {
        const stdout = std.io.getStdOut().writer();
        try stdout.print("Reconstruct request body: {s}\n", .{body});

        if (try req.json(ReconstructRequest)) |parsed| {
            var shares = try allocator.alloc(scheme.Share, parsed.shares.len);
            defer allocator.free(shares);

            var i: usize = 0;
            for (parsed.shares) |share| {
                var new_y = try Managed.init(allocator);
                try new_y.setString(10, share.y);

                shares[i] = scheme.Share{
                    .x = share.x,
                    .y = new_y,
                };
                i += 1;
            }

            const secret = state.?.SSSS.reconstruct_secret(shares) catch {
                return sendError(res, "Reconstruction failed, not enough shares");
            };
            defer secret.deinit();

            try stdout.print("Secret before: {any}\n", .{secret});
            try sendJson(res, .{
                .secret = try secret.toString(allocator, 10, .lower),
            });
        }
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
    try res.json(value, .{});
}
