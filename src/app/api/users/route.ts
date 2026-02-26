import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, email, name, role, avatar_url, last_login, created_at, updated_at")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Users GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch users" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name, role } = body;

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Email, password, and name are required" },
        { status: 400 }
      );
    }

    // Check if email already exists
    const { data: existing } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data, error } = await supabaseAdmin
      .from("users")
      .insert({
        email,
        password_hash,
        name,
        role: role || "member",
      })
      .select("id, email, name, role, avatar_url, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Users POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create user" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, role, password, current_password } = body;

    if (!id) {
      return NextResponse.json(
        { error: "User id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Handle password change (requires current_password verification)
    if (password) {
      if (!current_password) {
        return NextResponse.json(
          { error: "Current password is required to change password" },
          { status: 400 }
        );
      }

      // Fetch current password hash
      const { data: user, error: fetchError } = await supabaseAdmin
        .from("users")
        .select("password_hash")
        .eq("id", id)
        .single();

      if (fetchError || !user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }

      const isValid = await bcrypt.compare(current_password, user.password_hash);
      if (!isValid) {
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 403 }
        );
      }

      updates.password_hash = await bcrypt.hash(password, 12);
    }

    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;

    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", id)
      .select("id, email, name, role, avatar_url, last_login, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Users PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update user" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "User id is required" },
        { status: 400 }
      );
    }

    // Check that user is not deleting themselves
    const session = await auth();
    const currentUserId = (session?.user as unknown as Record<string, unknown>)?.id;

    if (currentUserId && currentUserId === id) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 403 }
      );
    }

    const { error } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Users DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete user" },
      { status: 500 }
    );
  }
}
