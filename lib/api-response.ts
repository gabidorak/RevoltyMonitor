import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function error(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export function unauthorized(message = "Unauthorized") {
  return error(message, 401);
}

export function forbidden(message = "Forbidden") {
  return error(message, 403);
}

export function notFound(message = "Not found") {
  return error(message, 404);
}

export function serverError(message = "Internal server error") {
  return error(message, 500);
}
