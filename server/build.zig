const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.host;
    const optimize = b.standardOptimizeOption(.{});
    const exe = b.addExecutable(.{
        .name = "server",
        .root_source_file = b.path("./src/server.zig"),
        .target = target,
        .optimize = optimize,
    });
        
    const httpz = b.dependency("httpz", .{
        .target = target,
        .optimize = optimize,
    });
    exe.root_module.addImport("httpz", httpz.module("httpz"));

    b.installArtifact(exe);
}
