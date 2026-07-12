import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 16) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD (min 16 chars) must be configured",
    );
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      role: "ADMIN",
      kycStatus: "APPROVED",
    },
    update: {
      passwordHash,
      role: "ADMIN",
      kycStatus: "APPROVED",
    },
  });

  console.log(`Admin ready: ${admin.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
