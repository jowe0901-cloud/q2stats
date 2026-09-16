export default async () => {
  return Response.json({
    status: "ok",
    message: "Q2Stats API is running"
  });
};

export const config = {
  path: "/api/test"
};