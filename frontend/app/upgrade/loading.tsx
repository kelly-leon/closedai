import { BrandLoader } from "../../components/BrandLoader";

export default function UpgradeLoading() {
  return <div className="absolute inset-0 z-20 grid place-items-center"><BrandLoader /></div>;
}
