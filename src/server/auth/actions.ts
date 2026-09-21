"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loginUser, registerUser } from "@/services/auth";

const TOKEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_COOKIE_MAX_AGE,
  });
}

export async function registerAction(formData: FormData) {
  const t = await getTranslations("errors");
  const result = await registerUser({
    username: formData.get("username") as string,
    password: formData.get("password") as string,
    displayName: formData.get("displayName") as string,
  });
  if (!result.ok) return { error: t(result.error as never) };
  await setSessionCookie(result.token);
  redirect("/dashboard");
}

export async function loginAction(formData: FormData) {
  const t = await getTranslations("errors");
  const result = await loginUser({
    username: formData.get("username") as string,
    password: formData.get("password") as string,
  });
  if (!result.ok) return { error: t(result.error as never) };
  await setSessionCookie(result.token);
  redirect("/dashboard");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete("session");
  redirect("/login");
}