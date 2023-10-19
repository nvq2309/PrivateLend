import { FunctionComponent, useCallback, useState } from "react";

interface LoginModalProps {
  visible: boolean;
}

const LoginModal: FunctionComponent<LoginModalProps> = ({ visible }) => {
  const handleLogin = () => {};
  if (visible)
    return (
      <>
        <div className="absolute top-[239.67px] left-[30.68px] rounded-[10.15px] bg-gray-100 shadow-[-3px_0px_33px_249px_rgba(0,_0,_0,_0.42)] w-[327.81px] h-[398.65px] [transform:_rotate(0.03deg)] [transform-origin:0_0]" />
        <div className="absolute top-[332.97px] left-[114px] text-[17.87px] leading-[27.72px] font-gilroy-regular text-gray-300 [transform:_rotate(0.03deg)] [transform-origin:0_0]">
          Choose an account
        </div>
        <div className="absolute top-[352.98px] left-[147px] text-[9.99px] leading-[15.49px] font-gilroy-regular text-gray-200 [transform:_rotate(0.03deg)] [transform-origin:0_0]">
          to continue to Tinder
        </div>
        <div className="absolute top-[281.99px] left-[169.06px] w-[51px] h-[51px] [transform:_rotate(0.03deg)] [transform-origin:0_0]">
          <div className="absolute top-[0px] left-[0px] rounded-[7px] [background:linear-gradient(180deg,_#eb4335,_#fd2c72_0.01%,_#f53658_64.76%,_#eb4335)] w-[51px] h-[51px] [transform:_rotate(0.03deg)] [transform-origin:0_0]" />
          <img
            className="absolute h-[69.75%] w-[59.37%] top-[13.75%] right-[19.09%] bottom-[16.5%] left-[21.54%] max-w-full overflow-hidden max-h-full"
            alt=""
            src="/vector.svg"
          />
        </div>
        <div className="absolute bottom-[224px] left-[calc(50%_-_139.98px)] text-xs leading-[15.49px] font-gilroy-regular flex items-center w-[278.98px] h-[49.13px] [transform:_rotate(0.03deg)] [transform-origin:0_0] text-darkslategray-200">
          <span className="[line-break:anywhere] w-full">
            <span>{`To continue, Google will share your name, email address and profile picture with Tinder. Before using this app, review it `}</span>
            <span className="text-mediumslateblue">privacy policy</span>
            <span>{` and `}</span>
            <span className="text-mediumslateblue">terms of service</span>
            <span>.</span>
          </span>
        </div>
        <div className="absolute top-[508.06px] left-[54.98px] w-[279px] h-[34px] [transform:_rotate(0.03deg)] [transform-origin:0_0]">
          <div className="absolute top-[calc(50%_+_20.44px)] left-[calc(50%_-_139.96px)] box-border w-[280px] h-px border-t-[1px] border-solid border-dimgray-200" />
          <div className="absolute top-[14px] left-[47px] leading-[15.49px] opacity-[0.6] text-black">
            xyz@gmail.com
          </div>
          <b className="absolute top-[0px] left-[47px] text-2xs leading-[15.49px] text-gray-300">
            Name
          </b>
          <img
            className="absolute top-[1px] left-[-0.01px] w-[27.01px] h-[26.01px]"
            alt=""
            src="/mask-group.svg"
          />
        </div>
        <div className="absolute top-[447px] left-[55px] w-[279px] h-[34px] [transform:_rotate(0.03deg)] [transform-origin:0_0]">
          <img
            className="absolute top-[calc(50%_+_22.37px)] left-[calc(50%_-_139.52px)] w-[279px] h-[1.13px]"
            alt=""
            src="/line-1.svg"
          />
          <div className="absolute top-[14px] left-[47px] leading-[15.49px] opacity-[0.6] text-black">
            xyz@gmail.com
          </div>
          <b className="absolute top-[0px] left-[47px] text-2xs leading-[15.49px] text-gray-300">
            Name
          </b>
          <img
            className="absolute top-[1px] left-[-0.01px] w-[27.01px] h-[26.01px]"
            alt=""
            src="/mask-group1.svg"
          />
        </div>
        <div
          className="absolute top-[386.94px] left-[55.02px] w-[279px] h-[34px] [transform:_rotate(0.03deg)] [transform-origin:0_0] cursor-pointer"
          onClick={handleLogin}
        >
          <div className="absolute top-[14px] left-[47px] leading-[15.49px] opacity-[0.6] text-black">
            amanmodi021@gmail.com
          </div>
          <div className="absolute top-[calc(50%_+_20.56px)] left-[calc(50%_-_140px)] box-border w-[280px] h-px border-t-[1px] border-solid border-dimgray-200" />
          <b className="absolute top-[0px] left-[47px] text-2xs leading-[15.49px] text-gray-300">
            Aman Modi
          </b>
          <img
            className="absolute top-[-2.94px] left-[-0.02px] w-[33px] h-[34.22px] object-cover"
            alt=""
            src="/userPic.png"
          />
        </div>
      </>
    );
  else return <></>;
};

const Login: FunctionComponent = () => {
  // If "Google is clicked, show LoginModal"
  const [isLoginModalVisible, setIsLoginModalVisible] = useState(false);
  const onRectangleClick = () => {
    setIsLoginModalVisible(!isLoginModalVisible);
  };

  const onTroubleLoggingInClick = useCallback(() => {}, []);

  return (
    <div className="relative [background:linear-gradient(180deg,_#fe5048,_#fd2c72_64.99%)] w-full h-[844px] overflow-hidden text-left text-xs text-white font-mulish">
      <div className="absolute top-[715px] left-[43px] w-[304px] h-[53px] text-[13.69px] text-darkslategray font-gilroy-semibold bg-white text-black rounded-[32px] shadow-[rgba(6,_24,_44,_0.4)_0px_0px_0px_2px,_rgba(6,_24,_44,_0.65)_0px_4px_6px_-1px,_rgba(255,_255,_255,_0.08)_0px_1px_0px_inset]">
        <div
          className="absolute h-full w-full top-[0%] right-[0%] bottom-[0%] left-[0%] rounded-[26.5px] bg-snow cursor-pointer"
          onClick={onRectangleClick}
        />
        <img
          className="absolute h-[43.4%] w-[7.24%] top-[28.3%] right-[86.18%] bottom-[28.3%] left-[6.58%] max-w-full overflow-hidden max-h-full"
          alt=""
          src="/google.svg"
        />
        <div className="absolute top-[26.42%] left-[25.66%] leading-[24.81px]">
          LOG IN WITH GOOGLE
        </div>
      </div>
      <b
        className="absolute top-[785px] left-[135px] text-[13.26px] leading-[24.03px] text-white cursor-pointer"
        onClick={onTroubleLoggingInClick}
      >
        Trouble logging in?
      </b>
      <b className="absolute top-[644px] left-[33px] leading-[15.31px] flex text-center items-center w-[323px] h-[55px]">
        <span className="[line-break:anywhere] w-full">
          {`By clicking “Log in”, you agree with our `}
          <span className="[text-decoration:underline]">Terms</span>
          {`. Learn how we process your data in our `}
          <span className="[text-decoration:underline]">Privacy Policy</span>
          {` and `}
          <span className="[text-decoration:underline]">Cookies Policy</span>.
        </span>
      </b>
      <div className="absolute top-[133px] left-[120px] w-[161px] h-[51px] text-center">
        <img
          className="absolute h-[69.7%] w-[93.17%] top-[0%] right-[6.83%] bottom-[30.3%] left-[0%] max-w-full overflow-hidden max-h-full"
          alt=""
          src="/medLogo.svg"
        />
      </div>
      <LoginModal visible={isLoginModalVisible} />
    </div>
  );
};

export default Login;
