import { FunctionComponent } from "react";

const LoadingScreen: FunctionComponent = () => {
  return (
    <div className="relative [background:linear-gradient(180deg,_#fe5048,_#fd2c72_64.99%)] w-full h-[844px] overflow-hidden">
      <img
        className="absolute h-[15.4%] w-[28.39%] top-[42.35%] right-[35.86%] bottom-[42.24%] left-[35.74%] max-w-full overflow-hidden max-h-full"
        alt=""
        src="/bigLogo.svg"
      />
    </div>
  );
};

export default LoadingScreen;
