/**
 * Calendar integration — ICS generation and draft event storage.
 *
 * No external calendar writes (Google/Outlook) in v1 — just ICS output
 * that Joseph can import or email to himself.
 */

import { prisma } from "@/src/prisma";

function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function generateIcs(args: {
  title: string;
  description?: string;
  startAt: Date;
  endAt?: Date;
  timezone?: string;
  uid?: string;
}): string {
  const uid = args.uid ?? `${Date.now()}@cofounder-agent`;
  const now = toIcsDate(new Date());
  const start = toIcsDate(args.startAt);
  const end = args.endAt ? toIcsDate(args.endAt) : toIcsDate(new Date(args.startAt.getTime() + 60 * 60 * 1000));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CofounderAgent//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${args.title.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}`,
  ];
  if (args.description) {
    lines.push(`DESCRIPTION:${args.description.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export async function createCalendarDraft(args: {
  userId: string;
  title: string;
  description?: string;
  startAt: Date;
  endAt?: Date;
  timezone?: string;
}) {
  const ics = generateIcs({
    title: args.title,
    description: args.description,
    startAt: args.startAt,
    endAt: args.endAt,
    timezone: args.timezone,
  });

  return prisma.calendarEvent.create({
    data: {
      userId: args.userId,
      title: args.title,
      description: args.description ?? null,
      startAt: args.startAt,
      endAt: args.endAt ?? null,
      timezone: args.timezone ?? "America/Chicago",
      icsContent: ics,
      status: "draft",
    },
  });
}

export async function listCalendarEvents(userId: string, limit = 50) {
  return prisma.calendarEvent.findMany({
    where: { userId },
    orderBy: { startAt: "desc" },
    take: limit,
  });
}
